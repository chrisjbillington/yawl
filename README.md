# yawl - yet another window list

A traditional window list for GNOME.

![screenshot.png](https://raw.githubusercontent.com/chrisjbillington/yawl/master/screenshot.png)

## Install

Currently compatible with GNOME 48.

I haven't applied to have this extension on `extensions.gnome.org` yet. In the meantime
you can install from git like so:
```bash
mkdir -p ~/.local/share/gnome-shell/extensions
cd ~/.local/share/gnome-shell/extensions
git clone https://github.com/chrisjbillington/yawl
glib-compile-schemas ~/.local/share/gnome-shell/extensions/yawl\@chrisjbillington.github.com/schemas/
```
Then enable from the GNOME extensions app. You may need to log out and in again before
GNOME extensions recognises it.

Please report any bugs.

## Features

### Window list
* Traditional ungrouped window list showing app icon and window title for each window on
  the corresponding monitor and workspace
* Tooltip shows full window title
* Scroll wheel to switch windows
* Middle click to close window
* Drag-drop to reorder window buttons or move them between monitors
* Window taskbar order should be preserved across monitor hotplugs or reloading the
  extension

### Favorites list
* Favourites launchers, click to launch
* Drag-drop reorderable

## Planned features
* Right click menu for favourites and window buttons (pin/unpin/close window, other
  things that make sense)
* Super+1/2/3 etc to launch favourites
* super+tab/super+shift+tab or similar to switch windows in taskbar order (similar to
  ctrl-tab/ctrl-shift-tab for browser tabs)
* Allow customising appearance
* Allow customising whether to isolate workspaces and monitors
* Allow hiding favourites launcher or moving to GNOME top panel

## Unplanned features
This extension is intended to be used with the GNOME top panel, not as a replacement for
it. Therefore there are no plans to include a clock or other status indicators as are
present in the GNOME top panel.

## Project status

As of 2025 I'm using this as a daily driver on Arch Linux and intend to keep it
functional on the latest GNOME.
