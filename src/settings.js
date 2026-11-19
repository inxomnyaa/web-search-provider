#!/usr/bin/env -S gjs -m
// Small settings window: pick the search engine.
import Gtk from 'gi://Gtk?version=4.0';
import Adw from 'gi://Adw?version=1';
import System from 'system';
import * as Config from './config.js';

const app = new Adw.Application({application_id: 'io.github.inxomnyaa.WebSearch'});

app.connect('activate', () => {
    if (app.active_window) {
        app.active_window.present();
        return;
    }
    const config = Config.load();
    const keys = Object.keys(Config.ENGINES);

    const engineRow = new Adw.ComboRow({
        title: 'Search engine',
        model: Gtk.StringList.new(keys.map(k => Config.ENGINES[k].name)),
        selected: Math.max(0, keys.indexOf(config.engine)),
    });
    const nameRow = new Adw.EntryRow({title: 'Name', text: config.customName});
    const urlRow = new Adw.EntryRow({title: 'URL, %s is replaced by your search', text: config.customUrl});

    const sync = () => {
        const custom = keys[engineRow.selected] === 'custom';
        nameRow.visible = urlRow.visible = custom;
        const valid = !custom || urlRow.text.includes('%s');
        if (valid)
            urlRow.remove_css_class('error');
        else
            urlRow.add_css_class('error');
        Config.save({engine: keys[engineRow.selected], customName: nameRow.text.trim(), customUrl: urlRow.text.trim()});
    };
    engineRow.connect('notify::selected', sync);
    nameRow.connect('changed', sync);
    urlRow.connect('changed', sync);

    const engineGroup = new Adw.PreferencesGroup({
        title: 'Web search',
        description: 'Used for the “Search … for” result in the Activities search.',
    });
    engineGroup.add(engineRow);
    engineGroup.add(nameRow);
    engineGroup.add(urlRow);

    const quickGroup = new Adw.PreferencesGroup({
        title: 'Quick answers',
        description: 'Start a search with ? to get a quick answer from DuckDuckGo, e.g. “?ffmpeg”. ' +
            'Press Enter on the answer to copy it.\n\nOnly searches starting with ? are sent to DuckDuckGo. ' +
            'Everything else stays on this computer until you open a result.',
    });

    const page = new Adw.PreferencesPage();
    page.add(engineGroup);
    page.add(quickGroup);

    const view = new Adw.ToolbarView({content: page});
    view.add_top_bar(new Adw.HeaderBar());

    const win = new Adw.ApplicationWindow({
        application: app,
        title: 'Web Search',
        default_width: 480,
        default_height: 460,
        content: view,
    });
    sync();
    win.present();
});

app.run([System.programInvocationName, ...ARGV]);
