import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import * as AppFavorites from 'resource:///org/gnome/shell/ui/appFavorites.js';
import {WindowButton} from './windowButton.js';
import {FavoritesButton} from './favoritesButton.js';

const DRAG_TIMEOUT_INTERVAL_MS = 50;

export class WindowList {
    constructor(panel) {
        this.panel = panel;
        this.windowButtons = [];
        this.favoritesButtons = [];
        
        this.widget = new St.BoxLayout({
            x_expand: false,
        });
        this.widget.connect('destroy', this._onWidgetDestroyed.bind(this));

        this.windowButtonsContainer = new St.BoxLayout({
            style_class: 'window-list-container',
            x_expand: false,
        });
        
        this.favoritesContainer = new St.BoxLayout({
            style_class: 'favorites-container',
            x_expand: false,
        });
        
        this.widget.add_child(this.favoritesContainer);
        this.widget.add_child(this.windowButtonsContainer);

        panel._leftBox.insert_child_at_index(this.widget, -1);

        AppFavorites.getAppFavorites().connectObject(
            'changed',
            this._recreateFavorites.bind(this),
            this,
        );
        
        this._createFavorites();
        
        global.display.connectObject(
            'window-created',
            this._onWindowCreated.bind(this),
            'window-entered-monitor',
            this._onWindowMonitorChanged.bind(this),
            'window-left-monitor',
            this._onWindowMonitorChanged.bind(this),
            this,
        );
        global.window_manager.connectObject(
            'switch-workspace',
            this._onSwitchWorkspace.bind(this),
            this,
        )

        global.get_window_actors().forEach(window => {
            this._onWindowCreated(global.display, window.meta_window);
        });
        
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
        window.connectObject(
            'unmanaged',
            this._onWindowUnmanaged.bind(this),
            'workspace-changed',
            this._onWindowWorkspaceChanged.bind(this),
            this,
        )

        const button = new WindowButton(window, this.panel.monitor.index, this.windowButtonsContainer);
        button.button.connect('scroll-event', this._onScrollEvent.bind(this));
        button.button.connect('button-press-event', this._onButtonPress.bind(this));
        button.button.connect('leave-event', this._onButtonLeave.bind(this));
        button.button.connect('enter-event', this._onButtonEnter.bind(this));
        this.windowButtons.push(button);
    }

    _onWindowMonitorChanged(display, monitor_index, window) {
        let button = this._getWindowButton(window);
        if (button) {
            button.updateVisibility();
        }
    }

    _onWindowWorkspaceChanged(window) {
        let button = this._getWindowButton(window);
        if (button) {
            button.updateVisibility();
        }
    }

    _onSwitchWorkspace() {
        this.windowButtons.forEach(button => {
            button.updateVisibility();
        });
    }

    _onWindowUnmanaged(window) {
        let buttonIndex = this._getWindowButtonIndex(window);
        let button = this.windowButtons[buttonIndex];
        if (button) {
            button.destroy();
            this.windowButtons.splice(buttonIndex, 1);
        }
    }
    
    _onScrollEvent(actor, event) {
        let direction = event.get_scroll_direction();
        if (direction === 0) {
            this._focusPreviousWindow();
        } else if (direction === 1) {
            this._focusNextWindow();
        }
        return true;
    }

    _focusNextWindow() {
        let visibleButtons = this.windowButtons.filter(btn => btn.button.visible);
        if (visibleButtons.length === 0) return;

        let currentIndex = visibleButtons.findIndex(btn => btn._isFocused());
        
        if (currentIndex === -1) {
            visibleButtons[0].window.activate(global.get_current_time());
            return;
        }
        
        if (currentIndex >= visibleButtons.length - 1) return;
        
        visibleButtons[currentIndex + 1].window.activate(global.get_current_time());
    }

    _focusPreviousWindow() {
        let visibleButtons = this.windowButtons.filter(btn => btn.button.visible);
        if (visibleButtons.length === 0) return;

        let currentIndex = visibleButtons.findIndex(btn => btn._isFocused());
        
        if (currentIndex === -1) {
            visibleButtons[visibleButtons.length - 1].window.activate(global.get_current_time());
            return;
        }
        
        if (currentIndex <= 0) return;
        
        visibleButtons[currentIndex - 1].window.activate(global.get_current_time());
    }

    _leftMouseButtonIsDown() {
        let [, , modifierMask] = global.get_pointer();
        return !!(modifierMask & Clutter.ModifierType.BUTTON1_MASK);
    }

    _onButtonPress(actor, event) {
        if (this._dragInProgress) {
            this._endDrag();
        }
    }

    _onButtonEnter(actor, event) {
        if (this._dragInProgress) {
            this._onDragTimeout();
        }
        return false;
    }

    _onButtonLeave(actor, event) {
        if (this._leftMouseButtonIsDown() && !this._dragInProgress) {
            let button = this.windowButtons.find(btn => btn.button === actor);
            if (button) {
                this._dragInProgress = true;
                this._draggedButton = button;
                this._draggedButton.setDragging(true);
                this._dragTimeoutId = GLib.timeout_add(
                    GLib.PRIORITY_DEFAULT,
                    DRAG_TIMEOUT_INTERVAL_MS,
                    this._onDragTimeout.bind(this),
                )
            }
        }
        return false;
    }

    _onDragTimeout() {
        if (!this._leftMouseButtonIsDown()) {
            this._endDrag();
            return;
        }
        
        if (!this.windowButtons.includes(this._draggedButton) || !this._draggedButton.button.visible) {
            this._endDrag();
            return;
        }

        let [x, y] = global.get_pointer();

        let [containerX, containerY] = this.windowButtonsContainer.get_transformed_position();
        let relativeX = x - containerX;
        
        let targetButton = this._getButtonAtPosition(relativeX);
        
        if (targetButton && targetButton !== this._draggedButton) {
            this._reorderToTarget(targetButton);
        }
        return GLib.SOURCE_CONTINUE;
    }

    _getButtonAtPosition(x) {
        if (x >= this.windowButtonsContainer.width) {
            let visibleButtons = this.windowButtons.filter(btn => btn.button.visible);
            return visibleButtons[visibleButtons.length - 1];
        } else if (x <= 0) {
            let visibleButtons = this.windowButtons.filter(btn => btn.button.visible);
            return visibleButtons[0];
        }

        for (let button of this.windowButtons) {
            if (!button.button.visible) continue;
            
            let [buttonX, buttonY] = button.button.get_position();
            let buttonWidth = button.button.width;
            
            if (x >= buttonX && x <= buttonX + buttonWidth) {
                return button;
            }
        }
        throw new Error("_getButtonAtPosition(): no button found");
    }

    _reorderToTarget(targetButton) {
        let targetIndex = this.windowButtonsContainer.get_children().indexOf(targetButton.button);
        let draggedIndex = this.windowButtonsContainer.get_children().indexOf(this._draggedButton.button);
        
        this.windowButtons.splice(draggedIndex, 1);
        
        this.windowButtons.splice(targetIndex, 0, this._draggedButton);
        
        this.windowButtonsContainer.set_child_at_index(this._draggedButton.button, targetIndex);
    }

    _endDrag() {
        if (this._draggedButton) {
            this._draggedButton.setDragging(false);
        }

        this._dragInProgress = false;
        this._draggedButton = null;
        
        if (this._dragTimeoutId) {
            GLib.source_remove(this._dragTimeoutId);
            this._dragTimeoutId = 0;
        }
    }

    _createFavorites() {
        let favorites = AppFavorites.getAppFavorites().getFavorites();
        favorites.forEach(app => {
            let button = new FavoritesButton(app, this.favoritesContainer);
            this.favoritesButtons.push(button);
        });
    }

    _destroyFavorites() {
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
        
        this._endDrag();
        
        this._destroyFavorites();
        
        this.windowButtons.forEach(button => {
            button.destroy();
            button.window.disconnectObject(this);
        });
        this.windowButtons = [];
        
        if (this.widget) {
            this.widget.destroy();
        }
    }
}