import * as Main from 'resource:///org/gnome/shell/ui/main.js'
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js'
import {Panel, WindowListManager} from './windowList.js';
import {ToolTip} from './tooltip.js';

// Feature checklist:
// - [x] Draw icon
// - [x] Update title when it changes
// - [x] Update icon when it changes
// - [x] Update alert status when it changes
// - [x] Update focus status when it changes
// - [x] Update minimised status when it changes
// - [x] Click raises or minimises
// - [x] Middle click close
// - [x] Scroll raises next window, no periodic boundary
// - [x] Click and drag reorders
// - [x] Window demanding attention gets highlighted
// - [x] Lighten on hover over and slightly more on click
// - [x] Dim significantly if minimised
// - [x] lightened if active window
// - [x] Minimise/restore animation should respect the location of the window list entry
// - [x] Windows moved to new workspaces/monitors should go to the end of the list
// - [x] Favourites should be launchers on the left
// - [x] Window order should survive suspend/restore/screen lock/monitor hotplugs
// - [x] Favourites drag-drop reorderable
// - [x] Favourites have tooltips
// - [x] Tooltip is window title
// - [ ] Super + 1, 2, 3 etc should launch favourites
// - [ ] Super tab/Super shift-tab should tab through windows in taskbar order
// - [ ] Right click should get window menu (maybe not possible)
// - [ ] Window list should not exceed available space in panel - buttons should shrink
// - [ ] Favourites have a context menu for e.g. unpinning
// - [ ] Window buttons context menu should have entry to allow pinning to favourites
// - [ ] Gnome panel mode - integrate in GNOME panel instead of dash to panel
// - [ ] Standalone mode - create own panels on primary or all monitors
// - [ ] Optionally put favourites in top bar when in standalone mode
// - [ ] at least with custom panel, make it look more like my tint2 config with borders
//   around buttons, slightly fatter panel so that favourites can be larger than 16px
//   (?) window button icons


const GSETTINGS_PATH = 'org.gnome.shell.extensions.panel-window-list';

export default class PanelWindowListExtension extends Extension {
    constructor(metadata) {
        // console.log("constructor()")
        super(metadata);
    }

    enable() {
        // console.log("enable()")
        this.panels = [];
        this.windowListManager = null;
        this.tooltip = new ToolTip();
        
        // Watch for monitor changes:
        Main.layoutManager.connectObject(
            'monitors-changed',
            this._recreatePanels.bind(this),
            this,
        );
        
        this._createPanels();
    }


    _createPanels() {
        // console.log("_createPanels()")
        const settings = this.getSettings(GSETTINGS_PATH);
        this.windowListManager = new WindowListManager(settings);
        
        // Create a panel for each monitor
        Main.layoutManager.monitors.forEach(monitor => {
            const panel = new Panel(monitor, this.windowListManager, this.tooltip);
            this.panels.push(panel);
        });
        
        this.windowListManager.get_initial_windows();
    }

    _destroyPanels() {
        // console.log("_destroyPanels()")
        // Clean up all Panel instances
        this.panels.forEach(panel => {
            panel.destroy();
        });
        this.panels = [];
        this.windowListManager.destroy();
        this.windowListManager = null;
    }

    _recreatePanels() {
        // console.log("_recreatePanels()")
        this._destroyPanels();
        this._createPanels();
    }

    disable() {
        // console.log("disable()")
        this._destroyPanels();
        if (this.tooltip) {
            this.tooltip.destroy();
            this.tooltip = null;
        }
        Main.layoutManager.disconnectObject(this);
    }
}
