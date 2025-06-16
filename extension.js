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
// - [ ] Super + 1, 2, 3 etc should launch favourites
// - [ ] Super tab/Super shift-tab should tab through windows in taskbar order
// - [ ] Right click should get window menu (maybe not possible)
// - [ ] Tooltip is window title
// - [ ] Window list should not exceed available space in panel - buttons should shrink
// - [ ] Favourites have tooltips
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
        
        // Watch for extensions being enabled and disabled:
        Main.extensionManager.connectObject(
            'extension-state-changed',
            this._onExtensionStateChanged.bind(this),
            this,
        );
        
        this._dashToPanel = null;

        // Check if dash to panel is active already:
        if (global.dashToPanel) {
            this._connectToDashToPanel();
        }
    }

    _onExtensionStateChanged(manager, extension) {
        // console.log("_onExtensionStateChanged()")
        // Dash to panel can be reset by GNOME shell calling its disable() and enable()
        // methods, without notifying us at all. GNOME shell does this whenever an
        // extension that was enabled before Dash to Panel was, is disabled. So we
        // aggressively check the existence and identity of the global dash to panel
        // object and update our connection to it accordingly
        if (global.dashToPanel && !this._dashToPanel) {
            // DashToPanel exists but we're not connected
            this._connectToDashToPanel();
        } else if (!global.dashToPanel && this._dashToPanel) {
            // DashToPanel gone but we're still connected
            this._disconnectFromDashToPanel();
        } else if (global.dashToPanel && this._dashToPanel && global.dashToPanel !== this._dashToPanel) {
            // DashToPanel exists but it's a different object
            this._reconnectToDashToPanel();
        }
    }

    _connectToDashToPanel() {
        // console.log("_connectToDashToPanel()")
        this._dashToPanel = global.dashToPanel;
        this._dashToPanel.connectObject(
            'panels-created',
            this._recreatePanels.bind(this),
            this
        );
        this._createPanels()
    }

    _disconnectFromDashToPanel() {
        // console.log("_disconnectFromDashToPanel()")
        this._destroyPanels();
        this._dashToPanel.disconnectObject(this);
        this._dashToPanel = null;
    }

    _reconnectToDashToPanel() {
        // console.log("_reconnectToDashToPanel()")
        this._disconnectFromDashToPanel();
        this._connectToDashToPanel();
    }

    _createPanels() {
        // console.log("_createPanels()")
        // Create new window lists for each panel:
        const settings = this.getSettings(GSETTINGS_PATH);
        this.windowListManager = new WindowListManager(settings)
        global.dashToPanel.panels.forEach(dtppanel => {
            const panel = new Panel(dtppanel, this.windowListManager, this.tooltip);
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
        if (this._dashToPanel) {
            this._disconnectFromDashToPanel();
        }
        if (this.tooltip) {
            this.tooltip.destroy();
            this.tooltip = null;
        }
        Main.extensionManager.disconnectObject(this);
    }
}
