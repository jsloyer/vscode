/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import 'vs/css!./selections';
import * as editorCommon from 'vs/editor/common/editorCommon';
import {DynamicViewOverlay} from 'vs/editor/browser/view/dynamicViewOverlay';
import {IRenderingContext, IViewContext} from 'vs/editor/browser/editorBrowser';

type HorizontalRange = editorCommon.HorizontalRange;
type LineVisibleRanges = editorCommon.LineVisibleRanges;

enum CornerStyle {
	EXTERN,
	INTERN,
	FLAT
}

interface IVisibleRangeEndPointStyle {
	top: CornerStyle;
	bottom: CornerStyle;
}

class HorizontalRangeWithStyle {
	public left: number;
	public width: number;
	public startStyle: IVisibleRangeEndPointStyle;
	public endStyle: IVisibleRangeEndPointStyle;

	constructor(other:HorizontalRange) {
		this.left = other.left;
		this.width = other.width;
		this.startStyle = null;
		this.endStyle = null;
	}
}

class LineVisibleRangesWithStyle {
	public lineNumber: number;
	public ranges: HorizontalRangeWithStyle[];

	constructor(lineNumber:number, ranges:HorizontalRangeWithStyle[]) {
		this.lineNumber = lineNumber;
		this.ranges = ranges;
	}
}

function toStyledRange(item: HorizontalRange): HorizontalRangeWithStyle {
	return new HorizontalRangeWithStyle(item);
}

function toStyled(item: LineVisibleRanges): LineVisibleRangesWithStyle {
	return new LineVisibleRangesWithStyle(item.lineNumber, item.ranges.map(toStyledRange));
}

// TODO@Alex: Remove this once IE11 fixes Bug #524217
// The problem in IE11 is that it does some sort of auto-zooming to accomodate for displays with different pixel density.
// Unfortunately, this auto-zooming is buggy around dealing with rounded borders
const isIEWithZoomingIssuesNearRoundedBorders = (
	(navigator.userAgent.indexOf('Trident/7.0') >= 0)
	|| (navigator.userAgent.indexOf('Edge/12') >= 0)
);


export class SelectionsOverlay extends DynamicViewOverlay {

	private static SELECTION_CLASS_NAME = 'selected-text';
	private static SELECTION_TOP_LEFT = 'top-left-radius';
	private static SELECTION_BOTTOM_LEFT = 'bottom-left-radius';
	private static SELECTION_TOP_RIGHT = 'top-right-radius';
	private static SELECTION_BOTTOM_RIGHT = 'bottom-right-radius';
	private static EDITOR_BACKGROUND_CLASS_NAME = 'monaco-editor-background';

	private static ROUNDED_PIECE_WIDTH = 10;

	private _context:IViewContext;
	private _lineHeight:number;
	private _roundedSelection:boolean;
	private _selections:editorCommon.IEditorRange[];
	private _renderResult:string[];

	constructor(context:IViewContext) {
		super();
		this._context = context;
		this._lineHeight = this._context.configuration.editor.lineHeight;
		this._roundedSelection = this._context.configuration.editor.roundedSelection;
		this._selections = [];
		this._renderResult = null;
		this._context.addEventHandler(this);
	}

	public dispose(): void {
		this._context.removeEventHandler(this);
		this._context = null;
		this._selections = null;
		this._renderResult = null;
	}

	// --- begin event handlers

	public onModelFlushed(): boolean {
		return true;
	}
	public onModelDecorationsChanged(e:editorCommon.IViewDecorationsChangedEvent): boolean {
		// true for inline decorations that can end up relayouting text
		return e.inlineDecorationsChanged;
	}
	public onModelLinesDeleted(e:editorCommon.IViewLinesDeletedEvent): boolean {
		return true;
	}
	public onModelLineChanged(e:editorCommon.IViewLineChangedEvent): boolean {
		return true;
	}
	public onModelLinesInserted(e:editorCommon.IViewLinesInsertedEvent): boolean {
		return true;
	}
	public onCursorPositionChanged(e:editorCommon.IViewCursorPositionChangedEvent): boolean {
		return false;
	}
	public onCursorSelectionChanged(e:editorCommon.IViewCursorSelectionChangedEvent): boolean {
		this._selections = [e.selection];
		this._selections = this._selections.concat(e.secondarySelections);
		return true;
	}
	public onCursorRevealRange(e:editorCommon.IViewRevealRangeEvent): boolean {
		return false;
	}
	public onConfigurationChanged(e:editorCommon.IConfigurationChangedEvent): boolean {
		if (e.lineHeight) {
			this._lineHeight = this._context.configuration.editor.lineHeight;
		}
		if (e.roundedSelection) {
			this._roundedSelection = this._context.configuration.editor.roundedSelection;
		}
		return true;
	}
	public onLayoutChanged(layoutInfo:editorCommon.IEditorLayoutInfo): boolean {
		return true;
	}
	public onScrollChanged(e:editorCommon.IScrollEvent): boolean {
		return e.scrollTopChanged;
	}
	public onZonesChanged(): boolean {
		return true;
	}

	// --- end event handlers

	private _visibleRangesHaveGaps(linesVisibleRanges: LineVisibleRangesWithStyle[]): boolean {

		var i:number,
			len:number,
			lineVisibleRanges:LineVisibleRangesWithStyle;

		for (i = 0, len = linesVisibleRanges.length; i < len; i++) {
			lineVisibleRanges = linesVisibleRanges[i];

			if (lineVisibleRanges.ranges.length > 1) {
				// There are two ranges on the same line
				return true;
			}
		}

		return false;
	}

	private _enrichVisibleRangesWithStyle(linesVisibleRanges:LineVisibleRangesWithStyle[], previousFrame:LineVisibleRangesWithStyle[]): void {
		var curLineRange: HorizontalRangeWithStyle,
			curLeft: number,
			curRight: number,
			prevLeft: number,
			prevRight: number,
			nextLeft: number,
			nextRight: number,
			startStyle: IVisibleRangeEndPointStyle,
			endStyle: IVisibleRangeEndPointStyle,
			i:number,
			len:number;

		var previousFrameTop: HorizontalRangeWithStyle = null,
			previousFrameBottom: HorizontalRangeWithStyle = null;

		if (previousFrame && previousFrame.length > 0 && linesVisibleRanges.length > 0) {

			var topLineNumber = linesVisibleRanges[0].lineNumber;
			for (var i = 0; !previousFrameTop && i < previousFrame.length; i++) {
				if (previousFrame[i].lineNumber === topLineNumber) {
					previousFrameTop = previousFrame[i].ranges[0];
				}
			}

			var bottomLineNumber = linesVisibleRanges[linesVisibleRanges.length - 1].lineNumber;
			for (var i = previousFrame.length - 1; !previousFrameBottom && i >= 0; i--) {
				if (previousFrame[i].lineNumber === bottomLineNumber) {
					previousFrameBottom = previousFrame[i].ranges[0];
				}
			}

			if (previousFrameTop && !previousFrameTop.startStyle) {
				previousFrameTop = null;
			}
			if (previousFrameBottom && !previousFrameBottom.startStyle) {
				previousFrameBottom = null;
			}
		}

		for (i = 0, len = linesVisibleRanges.length; i < len; i++) {
			// We know for a fact that there is precisely one range on each line
			curLineRange = linesVisibleRanges[i].ranges[0];
			curLeft = curLineRange.left;
			curRight = curLineRange.left + curLineRange.width;

			startStyle = {
				top: CornerStyle.EXTERN,
				bottom: CornerStyle.EXTERN
			};

			endStyle = {
				top: CornerStyle.EXTERN,
				bottom: CornerStyle.EXTERN
			};

			if (i > 0) {
				// Look above
				prevLeft = linesVisibleRanges[i-1].ranges[0].left;
				prevRight = linesVisibleRanges[i-1].ranges[0].left + linesVisibleRanges[i-1].ranges[0].width;

				if (curLeft === prevLeft) {
					startStyle.top = CornerStyle.FLAT;
				} else if (curLeft > prevLeft) {
					startStyle.top = CornerStyle.INTERN;
				}

				if (curRight === prevRight) {
					endStyle.top = CornerStyle.FLAT;
				} else if (prevLeft < curRight && curRight < prevRight) {
					endStyle.top = CornerStyle.INTERN;
				}
			} else if (previousFrameTop) {
				// Accept some hick-ups near the viewport edges to save on repaints
				startStyle.top = previousFrameTop.startStyle.top;
				endStyle.top = previousFrameTop.endStyle.top;
			}

			if (i + 1 < len) {
				// Look below
				nextLeft = linesVisibleRanges[i+1].ranges[0].left;
				nextRight = linesVisibleRanges[i+1].ranges[0].left + linesVisibleRanges[i+1].ranges[0].width;

				if (curLeft === nextLeft) {
					startStyle.bottom = CornerStyle.FLAT;
				} else if (nextLeft < curLeft && curLeft < nextRight) {
					startStyle.bottom = CornerStyle.INTERN;
				}

				if (curRight === nextRight) {
					endStyle.bottom = CornerStyle.FLAT;
				} else if (curRight < nextRight) {
					endStyle.bottom = CornerStyle.INTERN;
				}
			} else if (previousFrameBottom) {
				// Accept some hick-ups near the viewport edges to save on repaints
				startStyle.bottom = previousFrameBottom.startStyle.bottom;
				endStyle.bottom = previousFrameBottom.endStyle.bottom;
			}

			curLineRange.startStyle = startStyle;
			curLineRange.endStyle = endStyle;
		}
	}

	private _getVisibleRangesWithStyle(selection: editorCommon.IEditorRange, ctx: IRenderingContext, previousFrame:LineVisibleRangesWithStyle[]): LineVisibleRangesWithStyle[] {
		let _linesVisibleRanges = ctx.linesVisibleRangesForRange(selection, true) || [];
		let linesVisibleRanges = _linesVisibleRanges.map(toStyled);
		let visibleRangesHaveGaps = this._visibleRangesHaveGaps(linesVisibleRanges);

		if (!isIEWithZoomingIssuesNearRoundedBorders && !visibleRangesHaveGaps && this._roundedSelection) {
			this._enrichVisibleRangesWithStyle(linesVisibleRanges, previousFrame);
		}

		// The visible ranges are sorted TOP-BOTTOM and LEFT-RIGHT
		return linesVisibleRanges;
	}

	private _createSelectionPiece(top:number, height:string, className:string, left:number, width:number): string {
		return (
			'<div class="cslr '
			+ className
			+ '" style="top:'
			+ top.toString()
			+ 'px;left:'
			+ left.toString()
			+ 'px;width:'
			+ width.toString()
			+ 'px;height:'
			+ height
			+ 'px;"></div>'
		);
	}

	private _actualRenderOneSelection(output2:string[], visibleStartLineNumber:number, hasMultipleSelections:boolean, visibleRanges:LineVisibleRangesWithStyle[]): void {
		let visibleRangesHaveStyle = (visibleRanges.length > 0 && visibleRanges[0].ranges[0].startStyle);
		let fullLineHeight = (this._lineHeight).toString();
		let reducedLineHeight = (this._lineHeight - 1).toString();

		let firstLineNumber = (visibleRanges.length > 0 ? visibleRanges[0].lineNumber : 0);
		let lastLineNumber = (visibleRanges.length > 0 ? visibleRanges[visibleRanges.length - 1].lineNumber : 0);

		for (let i = 0, len = visibleRanges.length; i < len; i++) {
			let lineVisibleRanges = visibleRanges[i];
			let lineNumber = lineVisibleRanges.lineNumber;
			let lineIndex = lineNumber - visibleStartLineNumber;

			let lineHeight = hasMultipleSelections ? (lineNumber === lastLineNumber || lineNumber === firstLineNumber ? reducedLineHeight : fullLineHeight) : fullLineHeight;
			let top = hasMultipleSelections ? (lineNumber === firstLineNumber ? 1 : 0) : 0;

			let lineOutput = '';

			for (let j = 0, lenJ = lineVisibleRanges.ranges.length; j < lenJ; j++) {
				let visibleRange = lineVisibleRanges.ranges[j];

				if (visibleRangesHaveStyle) {
					if (visibleRange.startStyle.top === CornerStyle.INTERN || visibleRange.startStyle.bottom === CornerStyle.INTERN) {
						// Reverse rounded corner to the left

						// First comes the selection (blue layer)
						lineOutput += this._createSelectionPiece(top, lineHeight, SelectionsOverlay.SELECTION_CLASS_NAME, visibleRange.left - SelectionsOverlay.ROUNDED_PIECE_WIDTH, SelectionsOverlay.ROUNDED_PIECE_WIDTH);

						// Second comes the background (white layer) with inverse border radius
						let className = SelectionsOverlay.EDITOR_BACKGROUND_CLASS_NAME;
						if (visibleRange.startStyle.top === CornerStyle.INTERN) {
							className += ' ' + SelectionsOverlay.SELECTION_TOP_RIGHT;
						}
						if (visibleRange.startStyle.bottom === CornerStyle.INTERN) {
							className += ' ' + SelectionsOverlay.SELECTION_BOTTOM_RIGHT;
						}
						lineOutput += this._createSelectionPiece(top, lineHeight, className, visibleRange.left - SelectionsOverlay.ROUNDED_PIECE_WIDTH, SelectionsOverlay.ROUNDED_PIECE_WIDTH);
					}
					if (visibleRange.endStyle.top === CornerStyle.INTERN || visibleRange.endStyle.bottom === CornerStyle.INTERN) {
						// Reverse rounded corner to the right

						// First comes the selection (blue layer)
						lineOutput += this._createSelectionPiece(top, lineHeight, SelectionsOverlay.SELECTION_CLASS_NAME, visibleRange.left + visibleRange.width, SelectionsOverlay.ROUNDED_PIECE_WIDTH);

						// Second comes the background (white layer) with inverse border radius
						let className = SelectionsOverlay.EDITOR_BACKGROUND_CLASS_NAME;
						if (visibleRange.endStyle.top === CornerStyle.INTERN) {
							className += ' ' + SelectionsOverlay.SELECTION_TOP_LEFT;
						}
						if (visibleRange.endStyle.bottom === CornerStyle.INTERN) {
							className += ' ' + SelectionsOverlay.SELECTION_BOTTOM_LEFT;
						}
						lineOutput += this._createSelectionPiece(top, lineHeight, className, visibleRange.left + visibleRange.width, SelectionsOverlay.ROUNDED_PIECE_WIDTH);
					}
				}

				let className = SelectionsOverlay.SELECTION_CLASS_NAME;
				if (visibleRangesHaveStyle) {
					if (visibleRange.startStyle.top === CornerStyle.EXTERN) {
						className += ' ' + SelectionsOverlay.SELECTION_TOP_LEFT;
					}
					if (visibleRange.startStyle.bottom === CornerStyle.EXTERN) {
						className += ' ' + SelectionsOverlay.SELECTION_BOTTOM_LEFT;
					}
					if (visibleRange.endStyle.top === CornerStyle.EXTERN) {
						className += ' ' + SelectionsOverlay.SELECTION_TOP_RIGHT;
					}
					if (visibleRange.endStyle.bottom === CornerStyle.EXTERN) {
						className += ' ' + SelectionsOverlay.SELECTION_BOTTOM_RIGHT;
					}
				}
				lineOutput += this._createSelectionPiece(top, lineHeight, className, visibleRange.left, visibleRange.width);
			}

			output2[lineIndex] += lineOutput;
		}
	}

	private _previousFrameVisibleRangesWithStyle: LineVisibleRangesWithStyle[][] = [];
	public prepareRender(ctx:IRenderingContext): void {
		if (!this.shouldRender()) {
			throw new Error('I did not ask to render!');
		}

		let output: string[] = [];
		let visibleStartLineNumber = ctx.visibleRange.startLineNumber;
		let visibleEndLineNumber = ctx.visibleRange.endLineNumber;
		for (let lineNumber = visibleStartLineNumber; lineNumber <= visibleEndLineNumber; lineNumber++) {
			let lineIndex = lineNumber - visibleStartLineNumber;
			output[lineIndex] = '';
		}

		let thisFrameVisibleRangesWithStyle: LineVisibleRangesWithStyle[][] = [];
		for (let i = 0, len = this._selections.length; i < len; i++) {
			let selection = this._selections[i];
			if (selection.isEmpty()) {
				thisFrameVisibleRangesWithStyle.push(null);
				continue;
			}

			let visibleRangesWithStyle = this._getVisibleRangesWithStyle(selection, ctx, this._previousFrameVisibleRangesWithStyle[i]);
			thisFrameVisibleRangesWithStyle.push(visibleRangesWithStyle);
			this._actualRenderOneSelection(output, visibleStartLineNumber, this._selections.length > 1, visibleRangesWithStyle);
		}

		this._previousFrameVisibleRangesWithStyle = thisFrameVisibleRangesWithStyle;
		this._renderResult = output;
	}

	public render(startLineNumber:number, lineNumber:number): string {
		if (!this._renderResult) {
			return '';
		}
		let lineIndex = lineNumber - startLineNumber;
		if (lineIndex < 0 || lineIndex >= this._renderResult.length) {
			throw new Error('Unexpected render request');
		}
		return this._renderResult[lineIndex];
	}
}
