import pointInPolygon from 'point-in-polygon';

// see https://github.com/cytoscape/cytoscape.js/blob/master/src/extensions/renderer/base/load-listeners.js
function isMultSelKeyDown(e) {
  return e.shiftKey || e.metaKey || e.ctrlKey; // maybe e.altKey
}

function isSelected(ele) {
  return ele.selected();
}

function eleWouldBeSelected(ele) {
  return ele.selectable() && !ele.selected();
}

export class LassoHandler {
  cy;
  canvas;
  ctx;
  polygon;

  originalBoxSelectionEnabled;
  originalUserPanningEnabled;

  onGraphMouseDownBound = this.onGraphMouseDown.bind(this);
  onDocumentMouseMoveBound = this.onDocumentMouseMove.bind(this);
  onDocumentMouseUpBound = this.onDocumentMouseUp.bind(this);

  constructor(cy) {
    this.cy = cy;

    const originalCanvas = this.cy.container().querySelector('canvas[data-id="layer0-selectbox"]');
    this.canvas = document.createElement('canvas');
    this.canvas.setAttribute('data-id', 'layer0-lasso');
    this.canvas.width = originalCanvas.width;
    this.canvas.height = originalCanvas.height;
    this.canvas.setAttribute('style', originalCanvas.getAttribute('style'));
    originalCanvas.parentElement.insertBefore(this.canvas, originalCanvas);
    this.ctx = this.canvas.getContext('2d');

    this.cy.container().addEventListener('mousedown', this.onGraphMouseDownBound);
  }

  destroy() {
    this.cy.container().removeEventListener('mousedown', this.onGraphMouseDownBound);

    this.cy = undefined;
    this.canvas.remove();
    this.canvas = undefined;
    this.ctx = undefined;
  }

  onGraphMouseDown(event) {
    if (!(isMultSelKeyDown(event) || !this.cy.panningEnabled() || !this.cy.userPanningEnabled())) {
      return;
    }

    // prevent original behavior
    this.originalBoxSelectionEnabled = this.cy.boxSelectionEnabled();
    this.originalUserPanningEnabled = this.cy.userPanningEnabled();
    this.cy.boxSelectionEnabled(false);
    this.cy.userPanningEnabled(false);

    // activate lasso selection
    document.addEventListener('mousemove', this.onDocumentMouseMoveBound);
    document.addEventListener('mouseup', this.onDocumentMouseUpBound);
  }

  onDocumentMouseMove(event) {
    const clientPosition = [event.clientX, event.clientY];
    const graphPosition = this.getGraphPosition(clientPosition);

    if (!this.polygon) {
      this.polygon = [];
      this.cy.emit({ type: 'boxstart', originalEvent: event, position: { x: graphPosition[0], y: graphPosition[1] } });

      // hide mousedown hint
      this.cy.renderer().data.bgActivePosistion = undefined;
      this.cy.renderer().redrawHint('select', true);
      this.cy.renderer().redraw();
    }

    this.polygon.push(clientPosition);
    this.renderPolygon();
  }

  onDocumentMouseUp(event) {
    const clientPosition = [event.clientX, event.clientY];
    const graphPosition = this.getGraphPosition(clientPosition);

    this.finish();

    this.polygon = undefined;
    this.cy.emit({ type: 'boxend', originalEvent: event, position: { x: graphPosition[0], y: graphPosition[1] } });
    this.renderPolygon();

    // deactivate lasso selection
    document.removeEventListener('mousemove', this.onDocumentMouseMoveBound);
    document.removeEventListener('mouseup', this.onDocumentMouseUpBound);

    // restore original behavior
    this.cy.boxSelectionEnabled(this.originalBoxSelectionEnabled);
    this.cy.userPanningEnabled(this.originalUserPanningEnabled);
    this.originalBoxSelectionEnabled = undefined;
    this.originalUserPanningEnabled = undefined;

    // prevent unselecting in Cytoscape mouseup if user panning is disabled
    this.cy.renderer().hoverData.dragged = true;
    setTimeout(() => {
      this.cy.renderer().hoverData.dragged = false;
    }, 0);
  }

  /* private */ renderPolygon() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    if (!this.polygon) {
      return;
    }

    const style = this.cy.style();
    const color = style.core('selection-box-color').value;
    const borderColor = style.core('selection-box-border-color').value;
    const borderWidth = style.core('selection-box-border-width').value;
    const opacity = style.core('selection-box-opacity').value;

    // begin scaled drawing
    const pixelRatio = this.canvas.width / this.canvas.clientWidth;
    this.ctx.scale(pixelRatio, pixelRatio);

    // draw path
    const canvasPolygon = this.getCanvasPolygon(this.polygon);
    this.ctx.beginPath();
    this.ctx.moveTo(canvasPolygon[0], canvasPolygon[1]);
    for (let position of canvasPolygon) {
      this.ctx.lineTo(position[0], position[1]);
    }

    // stroke path
    if (borderWidth > 0) {
      this.ctx.lineWidth = borderWidth;
      this.ctx.strokeStyle = `rgba(${borderColor[0]}, ${borderColor[1]}, ${borderColor[2]}, ${opacity})`;
      this.ctx.stroke();
    }

    // fill path
    this.ctx.closePath();
    this.ctx.fillStyle = `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${opacity})`;
    this.ctx.fill();

    // end scaled drawing
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  /* private */ finish() {
    if (!this.polygon) {
      return;
    }

    const graphPolygon = this.getGraphPolygon(this.polygon);
    const matchedNodes = this.cy.nodes().filter(node => {
      const position = node.position();
      const point = [position.x, position.y];
      return pointInPolygon(point, graphPolygon);
    });

    if (!(isMultSelKeyDown(event) || this.cy.selectionType() === 'additive')) {
      this.cy.$(isSelected).unmerge(matchedNodes).unselect();
    }

    matchedNodes
      .emit('box')
      .stdFilter(eleWouldBeSelected)
        .select()
        .emit('boxselect');
  }

  /* private */ getCanvasPosition(clientPosition) {
    const offset = this.cy.renderer().findContainerClientCoords();
    const canvasPosition = [clientPosition[0] - offset[0], clientPosition[1] - offset[1]];
    return canvasPosition;
  }

  /* private */ getGraphPosition(clientPosition) {
    const graphPosition = this.cy.renderer().projectIntoViewport(clientPosition[0], clientPosition[1]);
    return graphPosition;
  }

  /* private */ getCanvasPolygon(clientPolygon) {
    const canvasPolygon = clientPolygon.map(clientPosition => this.getCanvasPosition(clientPosition));
    return canvasPolygon;
  }

  /* private */ getGraphPolygon(clientPolygon) {
    const graphPolygon = clientPolygon.map(clientPosition => this.getGraphPosition(clientPosition));
    return graphPolygon;
  }
}