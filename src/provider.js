#!/usr/bin/env -S gjs -m
// GNOME Shell search provider (org.gnome.Shell.SearchProvider2).
//
// Privacy: normal queries never touch the network; we only build a search URL.
// Only queries starting with "?" are sent to DuckDuckGo's Instant Answer API,
// and only once typing pauses for DEBOUNCE_MS.
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import Soup from 'gi://Soup?version=3.0';
import System from 'system';
import * as Config from './config.js';

const APP_ID = 'io.github.inxomnyaa.WebSearch.SearchProvider';
const OBJECT_PATH = '/io/github/inxomnyaa/WebSearch/SearchProvider';
const DEBOUNCE_MS = 450;
const FETCH_TIMEOUT_S = 5;
const PREFIX = '?';

const IFACE = `<node><interface name="org.gnome.Shell.SearchProvider2">
  <method name="GetInitialResultSet"><arg type="as" name="terms" direction="in"/><arg type="as" name="results" direction="out"/></method>
  <method name="GetSubsearchResultSet"><arg type="as" name="previous_results" direction="in"/><arg type="as" name="terms" direction="in"/><arg type="as" name="results" direction="out"/></method>
  <method name="GetResultMetas"><arg type="as" name="identifiers" direction="in"/><arg type="aa{sv}" name="metas" direction="out"/></method>
  <method name="ActivateResult"><arg type="s" name="identifier" direction="in"/><arg type="as" name="terms" direction="in"/><arg type="u" name="timestamp" direction="in"/></method>
  <method name="LaunchSearch"><arg type="as" name="terms" direction="in"/><arg type="u" name="timestamp" direction="in"/></method>
</interface></node>`;

const ENTITIES = {amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'"};
const cleanText = s => s.replace(/<[^>]*>/g, ' ')
    .replace(/&(#?\w+);/g, (m, e) => ENTITIES[e] ?? m)
    .replace(/\s+/g, ' ').trim();

const icon = name => new Gio.ThemedIcon({name}).serialize();

// "?foo" / "? foo" -> {quick: true, query: "foo"}
function parse(terms) {
    const text = terms.join(' ').trim();
    if (text.startsWith(PREFIX))
        return {quick: true, query: text.slice(PREFIX.length).trim()};
    return {quick: false, query: text};
}

class Provider {
    constructor(app) {
        this._app = app;
        this._session = new Soup.Session({timeout: FETCH_TIMEOUT_S, user_agent: 'gnome-web-search-provider/1.0'});
        this._answers = new Map(); // query -> {text, source} | null
        this._latest = 0;
    }

    // Wrap async D-Bus handlers: keep the service alive while working.
    _handle(invocation, promise) {
        this._app.hold();
        promise.then(value => invocation.return_value(value))
            .catch(e => {
                logError(e);
                invocation.return_value(new GLib.Variant('(as)', [[]]));
            })
            .finally(() => this._app.release());
    }

    GetInitialResultSetAsync([terms], invocation) {
        this._handle(invocation, this._results(terms).then(r => new GLib.Variant('(as)', [r])));
    }

    GetSubsearchResultSetAsync([, terms], invocation) {
        this._handle(invocation, this._results(terms).then(r => new GLib.Variant('(as)', [r])));
    }

    async _results(terms) {
        const {quick, query} = parse(terms);
        const ticket = ++this._latest;
        if (!query)
            return [];
        if (!quick)
            return [`search:${query}`];

        if (!this._answers.has(query)) {
            await new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, DEBOUNCE_MS, () => {
                resolve();
                return GLib.SOURCE_REMOVE;
            }));
            if (ticket !== this._latest) // user kept typing; never send partial queries
                return [];
            this._remember(query, await this._fetchAnswer(query));
        }
        const results = [`qsearch:${query}`];
        if (this._answers.get(query))
            results.unshift(`answer:${query}`);
        return results;
    }

    _remember(query, answer) {
        this._answers.set(query, answer);
        if (this._answers.size > 50)
            this._answers.delete(this._answers.keys().next().value);
    }

    async _fetchAnswer(query) {
        const uri = GLib.Uri.parse(`https://api.duckduckgo.com/?format=json&no_html=1&skip_disambig=1&q=${
            encodeURIComponent(query)}`, GLib.UriFlags.NONE);
        const msg = new Soup.Message({method: 'GET', uri});
        try {
            const bytes = await new Promise((resolve, reject) =>
                this._session.send_and_read_async(msg, GLib.PRIORITY_DEFAULT, null, (s, res) => {
                    try {
                        resolve(s.send_and_read_finish(res));
                    } catch (e) {
                        reject(e);
                    }
                }));
            if (msg.get_status() !== Soup.Status.OK)
                return null;
            const d = JSON.parse(new TextDecoder().decode(bytes.toArray()));
            if (typeof d.Answer === 'string' && d.Answer.trim())
                return {text: cleanText(d.Answer), source: 'DuckDuckGo'};
            if (d.Definition)
                return {text: cleanText(d.Definition), source: d.DefinitionSource || 'Definition'};
            if (d.AbstractText)
                return {text: cleanText(d.AbstractText), source: d.AbstractSource || 'Wikipedia'};
        } catch (e) {
            log(`quick answer failed: ${e.message}`);
        }
        return null;
    }

    GetResultMetas(ids) {
        const engine = Config.currentEngine();
        const metas = [];
        for (const id of ids) {
            const sep = id.indexOf(':');
            const [kind, query] = [id.slice(0, sep), id.slice(sep + 1)];
            const v = {id: GLib.Variant.new_string(id)};
            if (kind === 'answer') {
                const a = this._answers.get(query);
                if (!a)
                    continue;
                v.name = GLib.Variant.new_string(a.text.length > 300 ? `${a.text.slice(0, 300)}…` : a.text);
                v.description = GLib.Variant.new_string(`Quick answer · ${a.source} · Enter copies`);
                v.clipboardText = GLib.Variant.new_string(a.text); // GNOME Shell copies this on activation
                v.icon = icon('edit-copy-symbolic');
            } else {
                v.name = GLib.Variant.new_string(`Search ${engine.name} for “${query}”`);
                const hint = kind === 'qsearch' && this._answers.get(query) === null ? 'No quick answer · ' : '';
                v.description = GLib.Variant.new_string(`${hint}Opens in your browser`);
                v.icon = icon('web-browser');
            }
            metas.push(v);
        }
        return new GLib.Variant('(aa{sv})', [metas]);
    }

    ActivateResult(id, terms) {
        if (id.startsWith('answer:'))
            return; // copied by the shell via clipboardText
        this._open(id.slice(id.indexOf(':') + 1));
    }

    LaunchSearch(terms) {
        const {query} = parse(terms);
        if (query)
            this._open(query);
    }

    _open(query) {
        const url = Config.searchUrl(Config.currentEngine(), query);
        try {
            Gio.AppInfo.launch_default_for_uri(url, null);
        } catch (e) {
            logError(e, `opening ${url}`);
        }
    }
}

const ProviderApp = GObject.registerClass(class ProviderApp extends Gio.Application {
    vfunc_dbus_register(connection, path) {
        this._exported = Gio.DBusExportedObject.wrapJSObject(IFACE, new Provider(this));
        this._exported.export(connection, OBJECT_PATH);
        return super.vfunc_dbus_register(connection, path);
    }

    vfunc_dbus_unregister(connection, path) {
        this._exported?.unexport();
        super.vfunc_dbus_unregister(connection, path);
    }
});

const app = new ProviderApp({
    application_id: APP_ID,
    flags: Gio.ApplicationFlags.IS_SERVICE,
    inactivity_timeout: 60_000,
});

app.run([System.programInvocationName, ...ARGV]);
