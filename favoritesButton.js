import St from 'gi://St';

const ICON_SIZE = 18;

export class FavoritesButton {
    constructor(app, container) {
        this.button = new St.Button({
            style_class: 'favorites-button',
        });
        this.button.connect('destroy', this._onButtonDestroyed.bind(this));
        this.button.child = app.create_icon_texture(ICON_SIZE);
        
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