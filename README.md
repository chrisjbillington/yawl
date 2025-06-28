# yawl - yet another window list

A traditional window list for GNOME.

![screenshot.png](https://raw.githubusercontent.com/chrisjbillington/yawl/master/screenshot.png)

## Install

I haven't applied to have this extension on `extensions.gnome.org` yet. In the meantime
you can install from git like so:
```bash
mkdir -p ~/.local/share/gnome-shell/extensions
cd ~/.local/share/gnome-shell/extensions
git clone https://github.com/chrisjbillington/yawl yawl\@chrisjbillington.github.com/
glib-compile-schemas yawl\@chrisjbillington.github.com/schemas/
```
Then enable from the GNOME extensions app. You may need to log out and in again before
GNOME extensions recognises it.

If you don't have the gnome extensions app, you'll need to install it, e.g. for
Debian-based distros:

```bash
sudo apt install gnome-shell-extensions
```

Please report any bugs.

## GNOME version compatibility

This extension was developed and tested on GNOME 48 and also seems to work on GNOME 46
in basic testing. I've also tested it with GNOME 49 alpha. I've therefore optimistically
marked it as supporting GNOME 46–49.

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

Generally I intend to keep animations to a minimum.

## Project status

As of 2025 I'm using this as a daily driver on Arch Linux and intend to keep it
functional on the latest GNOME.
