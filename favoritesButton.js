import St from 'gi://St';

const ICON_SIZE = 18;

export class FavoritesButton {
    constructor(app, container, tooltip) {
        // console.log("FavoritesButton.constructor()");
        this.app = app;
        this.container = container;
        this._tooltip = tooltip;
        this._is_dragging = false;
        
        this.button = new St.Button({
            style_class: 'favorites-button',
        });
        
        this.button.connectObject(
            'clicked',
            this._onButtonClicked.bind(this),
            'destroy',
            this._onButtonDestroyed.bind(this),
            this,
        );

        this.button.child = app.create_icon_texture(ICON_SIZE);
        this._tooltip.set(this.button, this.app.get_name());

        container.add_child(this.button);
    }

    setDragging(isDragging) {
        // console.log("FavoritesButton.setDragging()");
        if (!this.button) return;
        if (isDragging) {
            this.button.add_style_class_name('dragging');
        } else {
            this.button.remove_style_class_name('dragging');
            // When dragging, we may not have received a release event. This ensures
            // styling is updated to reflect the button no longer being pressed:
            this.button.fake_release();
        }
        this._is_dragging = isDragging;
    }

    _onButtonClicked() {
        // console.log("FavoritesButton._onButtonClicked()");
        if (this._is_dragging) {
            // Ignore mouse release during drag (this instead ends the drag)
            return;
        }
        this.app.open_new_window(-1);
    }

    _onButtonDestroyed() {
        // console.log("FavoritesButton._onButtonDestroyed()");
        this.button = null;
    }

    destroy() {
        // console.log("FavoritesButton.destroy()");
        if (this.button) {
            this.button.destroy();
        }
    }
}
