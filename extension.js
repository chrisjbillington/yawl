import * as Main from 'resource:///org/gnome/shell/ui/main.js'
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js'
import {ExtensionState} from 'resource:///org/gnome/shell/misc/extensionUtils.js'
import * as AppFavorites from 'resource:///org/gnome/shell/ui/appFavorites.js'
import Shell from 'gi://Shell';
import St from 'gi://St';
import Mtk from 'gi://Mtk';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';

// Feature checklist:
// - [x] Draw icon
// - [x] Update title when it changes
// - [x] Update icon when it changes
// - [x] Update alert status when it changes
// - [x] Update focus status when it changes
// - [x] Update minimised status when it changes
// - [x] Click raises or minimises
// - [ ] Right click should get window menu (maybe not possible)
// - [x] Middle click close
// - [x] Scroll raises next window, no periodic boundary
// - [x] Click and drag reorders
// - [x] Window demanding attention gets highlighted
// - [x] Lighten on hover over and slightly more on click
// - [x] Dim significantly if minimised
// - [x] lightened if active window
// - [ ] Tooltip is window title
// - [x] Minimise/restore animation should respect the location of the window list entry
// - [ ] Window order should survive suspend/restore and monitor hotplugging
// - [x] Windows moved to new workspaces/monitors should go to the end of the list
// - [ ] Super tab/Super shift-tab should tab through windows in taskbar order
//   (probably: monitor order then taskbar order)
// - [ ] Window list should not exceed available space in panel - buttons should shrink
// - [x] Favourites should be launchers on the left
// - [ ] Favourites have tooltips
// - [ ] Favourites drag-drop reorderable
// - [ ] Favourites have a context menu for e.g. unpinning
// - [ ] Window buttons context menu should have entry  to allow pinning to favourites


const DRAG_TIMEOUT_INTERVAL_MS = 50;

const ISOLATE_MONITORS = true;
const ISOLATE_WORKSPACES = true;
const WINDOW_TITLE_WIDTH = 140;
const ICON_SIZE = 18;
const MINIMIZED_ALPHA = 0.5;


class WindowButton {
    constructor(window, monitor_index, container) {
        this.window = window;
        this.id = window.get_stable_sequence();
        this.monitor_index = monitor_index;
        
        this.button = new St.Button({
            style_class: 'window-button',
        });

        this._hbox = new St.BoxLayout({
            style_class: 'window-button-content',
        });

        this._icon = new St.Bin({});

        this._label = new St.Label({
            style_class: 'window-button-label',
        });
        
        this._hbox.add_child(this._icon);
        this._hbox.add_child(this._label);
        this.button.set_child(this._hbox);

        this.button.connect('destroy', this._onButtonDestroyed.bind(this));
        this.button.connect('clicked', this._onButtonClicked.bind(this));
        this.button.connect('button-press-event', this._onButtonPress.bind(this));

        // Monitor global focus changes
        global.display.connectObject(
            'notify::focus-window',
            this._updateStyle.bind(this),
            this,
        );

        this.window.connectObject(
            'notify::skip-taskbar',
            this.updateVisibility.bind(this),
            'notify::title',
            this._updateTitle.bind(this),
            'notify::wm-class',
            this._updateIcon.bind(this),
            'notify::gtk-application-id',
            this._updateIcon.bind(this),
            'notify::minimized',
            this._updateMinimized.bind(this),
            'notify::demands-attention',
            this._updateStyle.bind(this),
            'notify::urgent',
            this._updateStyle.bind(this),
            this,
        )
        
        this._updateTitle();
        this._updateIcon();
        this.updateVisibility();
        this._updateMinimized();
        this._updateStyle();

        container.add_child(this.button);
    }
    
    updateVisibility() {
        if (this.button) {
            let workspace = global.workspace_manager.get_active_workspace();
            let visible = !this.window.skip_taskbar &&
                   (!ISOLATE_WORKSPACES || this.window.located_on_workspace(workspace)) &&
                   (!ISOLATE_MONITORS || this.window.get_monitor() === this.monitor_index);
            this.button.visible = visible;
        }
    }

    _updateTitle() {
        if (this.button) {
            this._label.text = this.window.get_title() || '';
        }
    }

    _updateIcon() {
        if (this.button) {
            let app = Shell.WindowTracker.get_default().get_window_app(this.window);
            if (app) {
                this._icon.child = app.create_icon_texture(ICON_SIZE);
            } else {
                this._icon.child = new St.Icon({
                    icon_name: 'application-x-executable',
                    icon_size: ICON_SIZE,
                });
            }
        }
    }

    _updateMinimized() {
        this._updateIconGeometry();
        if (this.button) {
            let alpha = this.window.minimized ? MINIMIZED_ALPHA : 1.0;
            this._icon.opacity = alpha * 255;
            this._label.opacity = alpha * 255;
        }
    }

    _updateStyle() {
        if (!this.button) return;
        
        // Remove all state classes
        this.button.remove_style_class_name('focused');
        this.button.remove_style_class_name('urgent');
        
        // Add appropriate state class
        if (this.window.demands_attention || this.window.urgent) {
            this.button.add_style_class_name('urgent');
        }
        if (this._isFocused()) {
            this.button.add_style_class_name('focused');
        }
        // Sync hover state
        this.button.sync_hover();
    }
    
    setDragging(isDragging) {
        if (!this.button) return;
        if (isDragging) {
            this.button.add_style_class_name('dragging');
        } else {
            this.button.remove_style_class_name('dragging');
            // Remove "active" state for styling, may not be removed otherwise: 
            this.button.fake_release();
        }
        this._updateStyle();
    }

    _isFocused() {
        let focusedWindow = global.display.focus_window;

        // If focused window has skip_taskbar, check windows it is transient for:
        while (focusedWindow && focusedWindow.skip_taskbar) {
            focusedWindow = focusedWindow.get_transient_for();
        }
        return focusedWindow === this.window;
    }

    _updateIconGeometry() {
        if (this.button.visible) {
            let rect = new Mtk.Rectangle();
            [rect.x, rect.y] = this.button.get_transformed_position();
            [rect.width, rect.height] = this.button.get_transformed_size();
            this.window.set_icon_geometry(rect);   
        }
    }

    _onButtonPress(actor, event) {
        let button = event.get_button();
        if (button === 2) { // Middle mouse button
            this.window.delete(global.get_current_time());
            return true; // Prevent further handling
        }
        return false; // Allow other handlers to process
    }

    _onButtonClicked() {
        if (this._isFocused()) {
            // Window is already focused, minimize it
            this.window.minimize();
        } else {
            // Window is not focused, activate it
            this.window.activate(global.get_current_time());
        }
    }

    _onButtonDestroyed() {
        this.button = null;
    }

    destroy() {
        // Clear icon geometry to disable minimize animations
        if (this.window) {
            this.window.set_icon_geometry(null);
        }
        
        if (this.button) {
            this.button.destroy();
        }
    }
}


class FavoritesButton {
    constructor(app, container) {
        this.button = new St.Button({
            style_class: 'favorites-button',
        });
        this.button.connect('destroy', this._onButtonDestroyed.bind(this));
        this.button.child = app.create_icon_texture(ICON_SIZE);
        
        // Add click handler to launch a new instance of the app
        this.button.connect('clicked', () => {
            app.open_new_window(-1);
        });

        container.add_child(this.button);
    }

    _onButtonDestroyed() {
        this.button = null;
    }

    destroy() {
        if (this.button) {
            this.button.destroy();
        }
    }
}


class WindowList {
    constructor(panel) {
        this.panel = panel;
        this.windowButtons = [];
        this.favoritesButtons = [];
        
        // Main container widget for this panel
        this.widget = new St.BoxLayout({
            x_expand: false,
        });
        // Cleanup is done when this widget is destroyed, either by us or someone else:
        this.widget.connect('destroy', this._onWidgetDestroyed.bind(this));

        // Container for window buttons
        this.windowButtonsContainer = new St.BoxLayout({
            style_class: 'window-list-container',
            x_expand: false,
        });
        
        // Container for favorites launchers:
        this.favoritesContainer = new St.BoxLayout({
            style_class: 'favorites-container',
            x_expand: false,
        });
        
        // Add both containers to the main widget in order: favorites first, then window buttons
        this.widget.add_child(this.favoritesContainer);
        this.widget.add_child(this.windowButtonsContainer);

        // Insert main widget into panel's left box
        panel._leftBox.insert_child_at_index(this.widget, -1);

        // Connect to favorites changed signal
        AppFavorites.getAppFavorites().connectObject(
            'changed',
            this._recreateFavorites.bind(this),
            this,
        );
        
        // Create initial favorites
        this._createFavorites();
        
        // Watch for window creation, windows moving monitor, or workspace:
        global.display.connectObject(
            'window-created',
            this._onWindowCreated.bind(this),
            'window-entered-monitor',
            this._onWindowEnteredMonitor.bind(this),
            'window-left-monitor',
            this._onWindowLeftMonitor.bind(this),
            this,
        );
        global.window_manager.connectObject(
            'switch-workspace',
            this._onSwitchWorkspace.bind(this),
            this,
        )

        // Create initial window buttons:
        global.get_window_actors().forEach(window => {
            this._onWindowCreated(global.display, window.meta_window);
        });
        
        // Initialize drag state
        this._dragInProgress = false;
        this._draggedButton = null;
        this._dragTimeoutId = 0;
    }
    
    _getWindowButtonIndex(window) {
        const id = window.get_stable_sequence();
        return this.windowButtons.findIndex(btn => btn.id === id);
    }

    _getWindowButton(window) {
        const buttonIndex = this._getWindowButtonIndex(window)
        if (buttonIndex !== -1) {
            return this.windowButtons[buttonIndex];
        }
        return null;
    }

    _onWindowCreated(display, window) {
        // Monitor signals of interest:
        window.connectObject(
            'unmanaged',
            this._onWindowUnmanaged.bind(this),
            'workspace-changed',
            this._onWindowWorkspaceChanged.bind(this),
            this,
        )

        // Create WindowButton and add to window buttons container
        const button = new WindowButton(window, this.panel.monitor.index, this.windowButtonsContainer);
        button.button.connect('scroll-event', this._onScrollEvent.bind(this));
        button.button.connect('button-press-event', this._onButtonPress.bind(this));
        button.button.connect('leave-event', this._onButtonLeave.bind(this));
        button.button.connect('enter-event', this._onButtonEnter.bind(this));
        this.windowButtons.push(button);
    }
    
    _onWindowEnteredMonitor(display, monitor_index, window) {
        let button = this._getWindowButton(window);
        if (button) {
            // Move to the end of the list:
            if (ISOLATE_MONITORS) {
                this._moveButtonToEnd(button);
            }
            button.updateVisibility();
        }
    }

    _onWindowLeftMonitor(display, monitor_index, window) {
        let button = this._getWindowButton(window);
        if (button) {
            button.updateVisibility();
        }
    }
    
    _onWindowWorkspaceChanged(window) {
        let button = this._getWindowButton(window);
        if (button) {
            // Move to the end of the list:
            if (ISOLATE_WORKSPACES) {
                this._moveButtonToEnd(button);
            }
            button.updateVisibility();
        }
    }

    _onSwitchWorkspace() {
        this.windowButtons.forEach(button => {
            button.updateVisibility();
        });
    }

    _onWindowUnmanaged(window) {
        // Find and remove the corresponding WindowButton
        let buttonIndex = this._getWindowButtonIndex(window);
        let button = this.windowButtons[buttonIndex];
        if (button) {
            button.destroy();
            this.windowButtons.splice(buttonIndex, 1);
        }
    }
    
    _moveButtonToEnd(button) {
        // Move in window buttons container
        this.windowButtonsContainer.remove_child(button.button);
        this.windowButtonsContainer.add_child(button.button);
        
        // Move in array to keep in sync
        let index = this.windowButtons.indexOf(button);
        this.windowButtons.splice(index, 1);
        this.windowButtons.push(button);
    }

    _onScrollEvent(actor, event) {
        let direction = event.get_scroll_direction();
        if (direction === 0) { // Up
            this._focusPreviousWindow();
        } else if (direction === 1) { // Down
            this._focusNextWindow();
        }
        return true; // Handled
    }

    _focusNextWindow() {
        let visibleButtons = this.windowButtons.filter(btn => btn.button.visible);
        if (visibleButtons.length === 0) return;

        let currentIndex = visibleButtons.findIndex(btn => btn._isFocused());
        
        // If no window focused, focus first window
        if (currentIndex === -1) {
            visibleButtons[0].window.activate(global.get_current_time());
            return;
        }
        
        // If already at last window, don't wrap - do nothing
        if (currentIndex >= visibleButtons.length - 1) return;
        
        // Move to next window
        visibleButtons[currentIndex + 1].window.activate(global.get_current_time());
    }

    _focusPreviousWindow() {
        let visibleButtons = this.windowButtons.filter(btn => btn.button.visible);
        if (visibleButtons.length === 0) return;

        let currentIndex = visibleButtons.findIndex(btn => btn._isFocused());
        
        // If no window focused, focus last window
        if (currentIndex === -1) {
            visibleButtons[visibleButtons.length - 1].window.activate(global.get_current_time());
            return;
        }
        
        // If already at first window, don't wrap - do nothing
        if (currentIndex <= 0) return;
        
        // Move to previous window
        visibleButtons[currentIndex - 1].window.activate(global.get_current_time());
    }

    _leftMouseButtonIsDown() {
        // Check global button state - returns [x, y, modifier_mask]
        let [, , modifierMask] = global.get_pointer();
        return !!(modifierMask & Clutter.ModifierType.BUTTON1_MASK);
    }

    _onButtonPress(actor, event) {
        // End any existing drag to prevent overlapping
        if (this._dragInProgress) {
            this._endDrag();
        }
    }

    _onButtonEnter(actor, event) {
        // If the user is moving their mouse between buttons during a drag, do an update
        // of the drag state immediately instead of waiting for the timeout, to avoid
        // flicker
        if (this._dragInProgress) {
            this._onDragTimeout();
        }
        return false; // allow further processing (non-optional for enter/leave events)
    }

    _onButtonLeave(actor, event) {
        if (this._leftMouseButtonIsDown() && !this._dragInProgress) {
            // Start drag
            let button = this.windowButtons.find(btn => btn.button === actor);
            if (button) {
                this._dragInProgress = true;
                this._draggedButton = button;
                // Set dragging visual style on the button:
                this._draggedButton.setDragging(true);
                // Start timout to monitor pointer every 50ms during the drag
                this._dragTimeoutId = GLib.timeout_add(
                    GLib.PRIORITY_DEFAULT,
                    DRAG_TIMEOUT_INTERVAL_MS,
                    this._onDragTimeout.bind(this),
                )
            }
        }
        return false; // allow further processing (non-optional for enter/leave events)
    }

    _onDragTimeout() {
        if (!this._leftMouseButtonIsDown()) {
            this._endDrag();
            return;
        }
        
        // Check if dragged button still exists and is visible
        if (!this.windowButtons.includes(this._draggedButton) || !this._draggedButton.button.visible) {
            this._endDrag();
            return;
        }

        let [x, y] = global.get_pointer();

        // Convert to window buttons container coordinates
        let [containerX, containerY] = this.windowButtonsContainer.get_transformed_position();
        let relativeX = x - containerX;
        
        // Find target button based on x position
        let targetButton = this._getButtonAtPosition(relativeX);
        
        if (targetButton && targetButton !== this._draggedButton) {
            this._reorderToTarget(targetButton);
        }
        return GLib.SOURCE_CONTINUE;
    }

    _getButtonAtPosition(x) {
        // If position is outside container, return first or last visible button
        if (x >= this.windowButtonsContainer.width) {
            let visibleButtons = this.windowButtons.filter(btn => btn.button.visible);
            return visibleButtons[visibleButtons.length - 1];
        } else if (x <= 0) {
            let visibleButtons = this.windowButtons.filter(btn => btn.button.visible);
            return visibleButtons[0];
        }

        // Find button that contains this x position
        for (let button of this.windowButtons) {
            if (!button.button.visible) continue;
            
            let [buttonX, buttonY] = button.button.get_position();
            let buttonWidth = button.button.width;
            
            if (x >= buttonX && x <= buttonX + buttonWidth) {
                return button;
            }
        }
        // Should not happen:
        throw new Error("_getButtonAtPosition(): no button found");
    }

    _reorderToTarget(targetButton) {
        // Note the target index before removal (as specified)
        let targetIndex = this.windowButtons.indexOf(targetButton);
        let draggedIndex = this.windowButtons.indexOf(this._draggedButton);
        
        // Remove dragged button from current position
        this.windowButtons.splice(draggedIndex, 1);
        
        // Insert at target position (index noted before removal)
        this.windowButtons.splice(targetIndex, 0, this._draggedButton);
        
        this.windowButtonsContainer.set_child_at_index(this._draggedButton.button, targetIndex);
    }

    _endDrag() {
        
        // Clear dragging state
        if (this._draggedButton) {
            this._draggedButton.setDragging(false);
        }

        this._dragInProgress = false;
        this._draggedButton = null;
        
        // Stop monitoring the mouse state:
        if (this._dragTimeoutId) {
            GLib.source_remove(this._dragTimeoutId);
            this._dragTimeoutId = 0;
        }
    }

    _createFavorites() {
        // Create a button for each app in favorites:
        let favorites = AppFavorites.getAppFavorites().getFavorites();
        favorites.forEach(app => {
            let button = new FavoritesButton(app, this.favoritesContainer);
            this.favoritesButtons.push(button);
        });
    }

    _destroyFavorites() {
        // Clean up all favorites buttons:
        this.favoritesButtons.forEach(button => {
            button.destroy();
        });
        this.favoritesButtons = [];
    }

    _recreateFavorites() {
        this._destroyFavorites();
        this._createFavorites();
    }

    _onWidgetDestroyed() {
        this.widget = null;
    }

    destroy() {
        global.display.disconnectObject(this);
        global.window_manager.disconnectObject(this);
        AppFavorites.getAppFavorites().disconnectObject(this);
        
        // Clean up drag state
        this._endDrag();
        
        // Clean up favorites
        this._destroyFavorites();
        
        // Clean up all window buttons
        this.windowButtons.forEach(windowButton => {
            windowButton.destroy();
        });
        this.windowButtons = [];
        
        if (this.widget) {
            this.widget.destroy();
        }
    }
}


export default class PanelWindowListExtension extends Extension {
    constructor(metadata) {
        super(metadata);
    }

    enable() {
        this.windowLists = [];
        
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
        // Dash to panel can be reset by GNOME shell calling its disable() and enable()
        // methods, without notifying us at all. GNOME shell does this whenever an
        // extension that was enabled before Dash to Panel was, is disabled. So we
        // aggressively check the existence and identity of the global dash to panel
        // object and update our connection to it accordinfly
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
        this._dashToPanel = global.dashToPanel;
        this._dashToPanel.connectObject(
            'panels-created',
            this._recreateWindowLists.bind(this),
            this
        );
        this._createWindowLists()
    }

    _disconnectFromDashToPanel() {
        this._destroyWindowLists();
        this._dashToPanel.disconnectObject(this);
        this._dashToPanel = null;
    }

    _reconnectToDashToPanel() {
        this._disconnectFromDashToPanel();
        this._connectToDashToPanel();
    }

    _createWindowLists() {
        // Create new window lists for each panel:
        global.dashToPanel.panels.forEach(panel => {
            const windowList = new WindowList(panel);
            this.windowLists.push(windowList);
        });
    }

    _destroyWindowLists() {
        // Clean up all WindowList instances
        this.windowLists.forEach(windowList => {
            windowList.destroy();
        });
        this.windowLists = [];
    }

    _recreateWindowLists() {
        this._destroyWindowLists();
        this._createWindowLists();
    }

    disable() {
        if (this._dashToPanel) {
            this._disconnectFromDashToPanel();
        }
        Main.extensionManager.disconnectObject(this);
    }
}
