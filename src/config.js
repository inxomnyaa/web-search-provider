// Shared settings for the search provider and the settings window.
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

export const ENGINES = {
    duckduckgo: {name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=%s'},
    google: {name: 'Google', url: 'https://www.google.com/search?q=%s'},
    startpage: {name: 'Startpage', url: 'https://www.startpage.com/do/search?q=%s'},
    brave: {name: 'Brave Search', url: 'https://search.brave.com/search?q=%s'},
    bing: {name: 'Bing', url: 'https://www.bing.com/search?q=%s'},
    ecosia: {name: 'Ecosia', url: 'https://www.ecosia.org/search?q=%s'},
    custom: {name: 'Custom', url: ''},
};

const DEFAULTS = {engine: 'duckduckgo', customName: '', customUrl: ''};

const dir = GLib.build_filenamev([GLib.get_user_config_dir(), 'web-search-provider']);
export const CONFIG_FILE = Gio.File.new_for_path(GLib.build_filenamev([dir, 'config.json']));

export function load() {
    try {
        const [, bytes] = CONFIG_FILE.load_contents(null);
        return {...DEFAULTS, ...JSON.parse(new TextDecoder().decode(bytes))};
    } catch {
        return {...DEFAULTS};
    }
}

export function save(config) {
    GLib.mkdir_with_parents(dir, 0o700);
    CONFIG_FILE.replace_contents(new TextEncoder().encode(JSON.stringify(config, null, 2)),
        null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
}

// Name + URL template of the chosen engine; falls back to DuckDuckGo if the
// custom URL is missing its %s placeholder.
export function currentEngine(config = load()) {
    if (config.engine === 'custom' && config.customUrl.includes('%s'))
        return {name: config.customName || 'the web', url: config.customUrl};
    return ENGINES[config.engine] && config.engine !== 'custom' ? ENGINES[config.engine] : ENGINES.duckduckgo;
}

export function searchUrl(engine, query) {
    return engine.url.replaceAll('%s', encodeURIComponent(query));
}
