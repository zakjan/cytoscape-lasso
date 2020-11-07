import pointInPolygon from 'point-in-polygon';

/** @typedef {import('cytoscape')} cytoscape */

/**
 * @param {MouseEvent} event
 * @see https://github.com/cytoscape/cytoscape.js/blob/master/src/extensions/renderer/base/load-listeners.js
 */
function isMultSelKeyDown(event) {
  return event.shiftKey || event.metaKey || event.ctrlKey; // maybe event.altKey
}

export class LassoHandler {
  /** @type cytoscape.Core */
  cy;
  /** @type HTMLCanvasElement */
  canvas;
  /** @type CanvasRenderingContext2D */
  ctx;

  /** @type boolean | undefined */
  originalAutoungrabify;
  /** @type boolean | undefined */
  originalUserPanningEnabled;
  /** @type boolean | undefined */
  originalBoxSelectionEnabled;

  /** @type [number, number][] */
  polygon;
  /** @type boolean */
  activated = false;

  onGraphResizeBound = this.onGraphResize.bind(this);
  onGraphContainerMouseDownBound = this.onGraphContainerMouseDown.bind(this);
  onDocumentMouseMoveBound = this.onDocumentMouseMove.bind(this);
  onDocumentMouseUpBound = this.onDocumentMouseUp.bind(this);

  /**
   * @param {cytoscape.Core} cy
   */
  constructor(cy) {
    this.cy = cy;

    const graphContainer = /** @type HTMLElement */ (this.cy.container());
    const originalCanvas = graphContainer.querySelector('canvas[data-id="layer0-selectbox"]');
    this.canvas = document.createElement('canvas');
    this.canvas.setAttribute('data-id', 'layer0-lasso');
    this.canvas.setAttribute('style', originalCanvas.getAttribute('style'));
    this.onGraphResize();
    originalCanvas.parentElement.insertBefore(this.canvas, originalCanvas);

    this.ctx = this.canvas.getContext('2d');

    this.cy.on('resize', this.onGraphResizeBound);
    graphContainer.addEventListener('mousedown', this.onGraphContainerMouseDownBound);
  }

  destroy() {
    const graphContainer = /** @type HTMLElement */ (this.cy.container());
    this.cy.off('resize', this.onGraphResizeBound);
    graphContainer.removeEventListener('mousedown', this.onGraphContainerMouseDownBound);

    this.cy = undefined;
    this.canvas.remove();
    this.canvas = undefined;
    this.ctx = undefined;
  }

  onGraphResize() {
    this.canvas.width = this.cy.width() * this.cy.renderer().getPixelRatio();
    this.canvas.height = this.cy.height() * this.cy.renderer().getPixelRatio();
    this.canvas.style.width = `${this.cy.width()}px`;
    this.canvas.style.height = `${this.cy.height()}px`;
  }

  /**
   * @param {MouseEvent} event
   */
  onGraphContainerMouseDown(event) {
    const clientPosition = /** @type [number, number] */ ([event.clientX, event.clientY]);
    this.polygon = [clientPosition];

    document.addEventListener('mousemove', this.onDocumentMouseMoveBound);
    document.addEventListener('mouseup', this.onDocumentMouseUpBound);
  }

  /**
   * @param {MouseEvent} event
   */
  onDocumentMouseMove(event) {
    const clientPosition = /** @type [number, number] */ ([event.clientX, event.clientY]);
    this.polygon.push(clientPosition);

    const activated = this.activated;
    if (
      event.buttons === 1 &&
      (
        (
          (this.cy.renderer().hoverData.down == null || this.cy.renderer().hoverData.down.pannable()) &&
          !this.cy.renderer().hoverData.dragging && (isMultSelKeyDown(event) || !this.cy.panningEnabled() || !this.cy.userPanningEnabled())
        ) || (
          this.cy.renderer().hoverData.down &&
          isMultSelKeyDown(event)
        )
      ) &&
      this.cy.$('.eh-source').length === 0 // cytoscape-edgehandles compatibility
    ) {
      this.activate();
    }
    const activatedNow = !activated && this.activated;

    this.render();

    if (activatedNow) {
      // prevent original behavior
      this.originalAutoungrabify = this.cy.autoungrabify();
      this.originalUserPanningEnabled = this.cy.userPanningEnabled();
      this.originalBoxSelectionEnabled = this.cy.boxSelectionEnabled();
      this.cy.autoungrabify(true);
      this.cy.userPanningEnabled(false);
      this.cy.boxSelectionEnabled(false);

      // prevent mousedown hint
      this.cy.renderer().data.bgActivePosistion = undefined;
      this.cy.renderer().redrawHint('select', true);
      this.cy.renderer().redraw();

      const graphPosition = this.getGraphPosition(clientPosition);
      this.cy.emit({ type: 'boxstart', originalEvent: event, position: { x: graphPosition[0], y: graphPosition[1] } });
    }
  }

  /**
   * @param {MouseEvent} event
   */
  onDocumentMouseUp(event) {
    document.removeEventListener('mousemove', this.onDocumentMouseMoveBound);
    document.removeEventListener('mouseup', this.onDocumentMouseUpBound);

    if (!this.activated) {
      return;
    }

    const clientPosition = /** @type [number, number] */ ([event.clientX, event.clientY]);

    this.finish(event);

    this.polygon = undefined;

    this.render();

    // restore original behavior
    this.cy.autoungrabify(this.originalAutoungrabify);
    this.cy.userPanningEnabled(this.originalUserPanningEnabled);
    this.cy.boxSelectionEnabled(this.originalBoxSelectionEnabled);
    this.originalAutoungrabify = undefined;
    this.originalUserPanningEnabled = undefined;
    this.originalBoxSelectionEnabled = undefined;

    // prevent unselecting in Cytoscape mouseup if user panning is disabled
    this.cy.renderer().hoverData.dragged = true;

    const graphPosition = this.getGraphPosition(clientPosition);
    this.cy.emit({ type: 'boxend', originalEvent: event, position: { x: graphPosition[0], y: graphPosition[1] } });
  }

  /**
   * @private
   */
  activate() {
    if (this.activated) {
      return;
    }

    const firstPosition = this.polygon[0];
    const lastPosition = this.polygon[this.polygon.length - 1];

    const dx = lastPosition[0] - firstPosition[0];
    const dx2 = dx * dx;
    const dy = lastPosition[1] - firstPosition[1];
    const dy2 = dy * dy;
    const dist2 = dx2 + dy2;
    const isOverThresholdDrag = dist2 >= this.cy.renderer().desktopTapThreshold2;

    if (isOverThresholdDrag) {
      this.activated = true;
    }
  }

  /**
   * @private
   * @param {MouseEvent} event
   */
  finish(event) {
    if (!this.activated) {
      return;
    }

    const graphPolygon = this.getGraphPolygon(this.polygon);
    const matchedNodes = this.cy.nodes().filter(node => {
      const position = node.position();
      const point = [position.x, position.y];
      return pointInPolygon(point, graphPolygon);
    });

    if (!isMultSelKeyDown(event) && this.cy.selectionType() !== 'additive') {
      this.cy.$(':selected').unmerge(matchedNodes).unselect();
    }

    matchedNodes
      .emit('box')
      .filter(':selectable:unselected')
        .select()
        .emit('boxselect');

    this.activated = false;
  }

  /**
   * @private
   */
  render() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    if (!this.activated) {
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

  /**
   * @private
   * @param {[number, number]} clientPosition
   * @return {[number, number]}
   */
  getCanvasPosition(clientPosition) {
    const offset = this.cy.renderer().findContainerClientCoords();
    const canvasPosition = /** @type [number, number] */ ([clientPosition[0] - offset[0], clientPosition[1] - offset[1]]);
    return canvasPosition;
  }

  /**
   * @private
   * @param {[number, number]} clientPosition
   * @return {[number, number]}
   */
  getGraphPosition(clientPosition) {
    const graphPosition = this.cy.renderer().projectIntoViewport(clientPosition[0], clientPosition[1]);
    return graphPosition;
  }

  /**
   * @private
   * @param {[number, number][]} clientPolygon
   * @return {[number, number][]}
   */
  getCanvasPolygon(clientPolygon) {
    const canvasPolygon = clientPolygon.map(clientPosition => this.getCanvasPosition(clientPosition));
    return canvasPolygon;
  }

  /**
   * @private
   * @param {[number, number][]} clientPolygon
   * @return {[number, number][]}
   */
  getGraphPolygon(clientPolygon) {
    const graphPolygon = clientPolygon.map(clientPosition => this.getGraphPosition(clientPosition));
    return graphPolygon;
  }
}