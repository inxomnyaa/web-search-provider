#!/bin/bash
# Installs for the current user. The search-provider .ini has to go to a
# system data dir (GNOME Shell ignores ~/.local for these), so that one step uses sudo.
set -euo pipefail
cd "$(dirname "$0")"
PREFIX="$HOME/.local/share/web-search-provider"
DATA="$HOME/.local/share"
INI_DIR=/usr/local/share/gnome-shell/search-providers

if [ "${1:-}" = "--uninstall" ]; then
    rm -rf "$PREFIX" "$DATA/applications/io.github.inxomnyaa.WebSearch.desktop" \
        "$DATA/dbus-1/services/io.github.inxomnyaa.WebSearch.SearchProvider.service"
    sudo rm -f "$INI_DIR/io.github.inxomnyaa.WebSearch.search-provider.ini"
    echo "Uninstalled (settings in ~/.config/web-search-provider kept)."
    exit 0
fi

# .ini first: GNOME Shell rescans providers when the .desktop file appears below.
sudo install -D -m 644 data/io.github.inxomnyaa.WebSearch.search-provider.ini "$INI_DIR/io.github.inxomnyaa.WebSearch.search-provider.ini"
mkdir -p "$PREFIX" "$DATA/applications" "$DATA/dbus-1/services"
install -m 755 src/provider.js src/settings.js "$PREFIX/"
install -m 644 src/config.js "$PREFIX/"
sed "s|@PREFIX@|$PREFIX|" data/io.github.inxomnyaa.WebSearch.desktop > "$DATA/applications/io.github.inxomnyaa.WebSearch.desktop"
sed "s|@PREFIX@|$PREFIX|" data/io.github.inxomnyaa.WebSearch.SearchProvider.service > "$DATA/dbus-1/services/io.github.inxomnyaa.WebSearch.SearchProvider.service"

# Make the session bus notice the new .service file (otherwise "name is not activatable").
busctl --user call org.freedesktop.DBus /org/freedesktop/DBus org.freedesktop.DBus ReloadConfig >/dev/null || true

# Restart a running provider so it picks up new code.
pkill -f "^gjs -m $PREFIX/provider.js" 2>/dev/null || true
echo "Installed. Try typing in the Activities search; if no Web Search row shows up, log out and back in once."
