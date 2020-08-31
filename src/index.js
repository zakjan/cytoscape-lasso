import { LassoHandler } from './lasso-handler';

function register(cytoscape) {
  if (!cytoscape) {
    return;
  }

  cytoscape('core', 'lassoSelectionEnabled', function(bool) {
    if (bool !== undefined) {
      this._private.lassoSelectionEnabled = bool ? true : false;
    } else {
      return this._private.lassoSelectionEnabled;
    }

    if (bool && !this._private.lassoHandler) {
      this._private.lassoHandler = new LassoHandler(this);
    } else if (!bool && this._private.lassoHandler) {
      this._private.lassoHandler.destroy();
      this._private.lassoHandler = undefined;
    }

    return this; // chaining
  });
}

if (typeof window.cytoscape !== 'undefined') {
  register(window.cytoscape);
}

export default register;