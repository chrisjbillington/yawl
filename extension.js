import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import St from 'gi://St';

// Feature checklist:
// Click raises or minimises
// Right click should get window menu
// Middle click close
// Scroll raises next window, no periodic boundary
// Click and drag reorders
// Window demanding attention gets highlighted
// Lighten on hover over and slightly more on click
// Dim significantly if minimised
// lightened if active window
// Tooltip is window title
// Minimise/restore animation should respect the location of the window list entry
// Window order should survive suspend/restore and monitor hotplugging

// Architecture plan:
// * For each panel, we make a WindowList instance (which will be a class we'll have to
//   implement), which loads all existing windows and watches for new ones. These
//   WindowList instances are totally independent. Each contains an ordered list of all
//   windows regardless of display/workspace/etc, which will be filtered for display
//   later.

const DASH_TO_PANEL_UUID = 'dash-to-panel@jderose9.github.com';

export default class PanelWindowListExtension extends Extension {
    constructor(metadata) {
        super(metadata);
    }

    enable() {
        // Watch for extensions being enabled and disabled:
        Main.extensionManager.connectObject(
            'extension-state-changed',
            this._onExtensionStateChanged.bind(this),
            this,
        );
        // Watch for monitors being added, removed, or  modified:
        Main.layoutManager.connectObject(
            'monitors-changed',
            this._onMonitorsChanged.bind(this),
            this,
        );
        // Watch for window creation:
        global.display.connectObject(
            'window-created',
            this._onWindowCreated.bind(this),
            'window-entered-monitor',
            this._onWindowEnteredMonitor.bind(this),
            this
        );

        // Keyed by monitor index:
        this.window_lists = {};
        global.get_window_actors().forEach(window => {
            this._onWindowCreated(global.display, window.meta_window);
        })
        console.log("PWL enabled");
    }

    _onExtensionStateChanged(manager, extension) {
        if (extension.uuid === DASH_TO_PANEL_UUID && extension.state === ExtensionState.ENABLED) {
            // Dash to panel is enabled. Start watching for panel creation:
            global.dashToPanel.connectObject(
                'panels-created',
                this._onPanelsCreated.bind(this),
                this
            );
        }
    }

    _onPanelsCreated() {
        console.log("Panels created");
        panels.global.dashToPanel.panels(panel => {
            console.log(`Got panel on monitor ${panel.monitor.index}`);
        });
        // TODO insert our window lists into panels
    }

    _onMonitorsChanged() {
        console.log("Monitors changed");
    }

    // _onWorkspaceAdded() {
    //     console.log("Workspace added");
    // }

    // _onWorkspaceRemoved() {
    //     console.log("Workspace removed");
    // }

    _onWindowCreated(display, window) {
        // Determine monitor by getting centre of window and seeing what monitor's
        // bounds it is within or closest to
        let title = window.get_title();
        let wm_class = window.get_wm_class(); 
        let type = window.window_type;
        let workspace = window.get_workspace();
        let workspace_index = workspace.index();
        let monitor = window.get_monitor();
        let sticky = window.is_on_all_workspaces();
        let skip_taskbar = window.skip_taskbar;
        let minimized = window.minimized;
        let hidden = window.is_hidden();

        console.log("_onWindowCreated() called:");
        console.log(`            title: ${title}`);
        console.log(`         wm_class: ${wm_class}`);
        console.log(`             type: ${type}`);
        console.log(`  workspace_index: ${workspace_index}`);
        console.log(`          monitor: ${monitor}`);
        console.log(`           sticky: ${sticky}`);
        console.log(`     skip_taskbar: ${skip_taskbar}`);
        console.log(`        minimized: ${minimized}`);
        console.log(`           hidden: ${hidden}`);

        // Monitor signals of interest:
        window.connectObject('unmanaged', this._onWindowUnmanaged.bind(this), this)

        if (!this.window_lists[monitor]) {
            this.window_lists[monitor] = [];
        }
        // Insert into global list
        // Insert panel item into all panels
        this.window_lists[monitor].push(window.get_id());
    }

    _onWindowEnteredMonitor(display, window) {
        console.log("_onWindowEnteredMonitor() called");
    }

    _onWindowUnmanaged(window) {
        console.log("_onWindowUnmanaged() called");
    }

    _addToPanel(panel) {
        let button = new St.Label({
            text: 'Window List',
            style_class: 'panel-button',
            width: 140,
            x_expand: false,
        });
        panel._leftBox.insert_child_at_index(button, -1);
        this._buttons.push(button)
    }

    _removeFromPanel(panel) {
        this._buttons = this._buttons.filter(item => {
            if (item.panel === panel) {
                item.label.destroy();
                return false;
            }
            return true;
        });
    }

    disable() {
        global.dashToPanel.disconnectObject(this);
        Main.layoutManager.disconnectObject(this);
        Main.extensionManager.disconnectObject(this);

        // Clean up Dash to Panel panels
        // this._labels.forEach(label => {
        //     label.get_parent()?.remove_child(label);
        //     label.destroy();
        // });
        // this._labels = [];

        // if (this._label) {
        //     Main.panel._leftBox.remove_child(this._label);
        //     this._label.destroy();
        //     this._label = null;
        // }
        console.log("PWL extension disabled");
    }
}
