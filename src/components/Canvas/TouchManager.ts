import { MouseEvent, TouchEvent, WheelEvent } from "react";

function referenceSafeRemove<T>(array: T[], index: number) {
    for (let i = index; i < array.length; i++) {
        if (i < (array.length - 1)) {
            array[i] = array[i + 1];
        }
    }
    array.pop();
}

// https://www.w3schools.com/jsref/event_button.asp
function touchToButton(nTouches: number) {
    if (nTouches == 0) return -1; // Invalid
    else if (nTouches == 1) return 0; // Left Mouse button
    else if (nTouches == 2) return 2; // Right Mouse button
    else if (nTouches == 3) return 1; // Middle Mouse button
    else if (nTouches == 4) return 0; // Left and Right
    else if (nTouches == 5) return 0; // Left and Right and Middle
    else return nTouches; // ?
}

// https://www.w3schools.com/jsref/event_buttons.asp
function touchToButtons(nTouches: number) {
    if (nTouches == 0) return 0; // None
    else if (nTouches == 1) return 1; // Left Mouse button
    else if (nTouches == 2) return 2; // Right Mouse button
    else if (nTouches == 3) return 4; // Middle Mouse button
    else if (nTouches == 4) return 1 + 2; // Left and Right
    else if (nTouches == 5) return 1 + 2 + 4; // Left and Right and Middle
    else return 8;
}

export function normalizeWheel(event: WheelEvent) {
    // Reasonable defaults
    let PIXEL_STEP = 10;
    let LINE_HEIGHT = 40;
    let PAGE_HEIGHT = 800;

    let sX = 0, sY = 0,       // spinX, spinY
        pX = 0, pY = 0;       // pixelX, pixelY

    // Legacy
    if ('detail' in event) { sY = event.detail; }
    if ('wheelDelta' in event) { sY = -(event.wheelDelta as number) / 120; }
    if ('wheelDeltaY' in event) { sY = -(event.wheelDeltaY as number) / 120; }
    if ('wheelDeltaX' in event) { sX = -(event.wheelDeltaX as number) / 120; }

    // side scrolling on FF with DOMMouseScroll
    // if ( 'axis' in event && event.axis === event.HORIZONTAL_AXIS ) {
    // 	sX = sY;
    // 	sY = 0;
    // }

    pX = sX * PIXEL_STEP;
    pY = sY * PIXEL_STEP;

    if ('deltaY' in event) { pY = event.deltaY; }
    if ('deltaX' in event) { pX = event.deltaX; }

    if ((pX || pY) && event.deltaMode) {
        if (event.deltaMode == 1) {          // delta in LINE units
            pX *= LINE_HEIGHT;
            pY *= LINE_HEIGHT;
        } else {                             // delta in PAGE units
            pX *= PAGE_HEIGHT;
            pY *= PAGE_HEIGHT;
        }
    }

    // Fall-back if spin cannot be determined
    if (pX && !sX) { sX = (pX < 1) ? -1 : 1; }
    if (pY && !sY) { sY = (pY < 1) ? -1 : 1; }

    return {
        spinX: sX,
        spinY: sY,
        pixelX: pX,
        pixelY: pY
    };
}

export type CanvasEventType = MouseEvent | TouchEvent | WheelEvent | Event | {
    pageX: number,
    pageY: number,
    clientX: number,
    clientY: number,
    screenX: number,
    screenY: number,
    button: number,
    buttons: number,
    delta?: number
};

export type CanvasEventFn<T> = (e: CanvasEventType, estado: T) => Partial<T> | false | null | undefined;

export default class TouchManager<T> {
    touches: { id: number, x: number, y: number }[];
    events: { [key: string]: CanvasEventFn<T> };
    TOUCH_DELAY: number;
    numTouches: number;
    touchDownIssued: boolean;
    touchDownDistance: number;
    touchDownPosition: { x: number, y: number } | false;

    constructor() {
        this.touches = [];
        this.events = {};
        this.TOUCH_DELAY = 150;
        this.numTouches = 0;
        this.touchDownIssued = false;
        this.touchDownDistance = 0;
        this.touchDownPosition = false;
    }

    fireEvent(eventName: string, touchPos: {x: number, y: number}, args: T) {
        if (!this.events[eventName]) return;

        let fake_e = {
            // are those the same?
            pageX: touchPos.x,
            pageY: touchPos.y,
            clientX: touchPos.x,
            clientY: touchPos.y,
            screenX: touchPos.x,
            screenY: touchPos.y,
            button: touchToButton(this.numTouches),
            buttons: eventName == "onTouchUp" ? 0 : touchToButtons(this.numTouches)

            // relatedTarget
            // altKey, crtlKey, shiftKey, metaKey, getModifierState(key)
        };

        this.events[eventName](fake_e, args);
    }

    getTouchByID(id: number) {
        for (let i = 0; i < this.touches.length; i++) {
            if (this.touches[i].id == id) return this.touches[i];
        }
        return false;
    }

    addEventListener(e: string, func: CanvasEventFn<T>) {
        this.events[e] = func;
    }

    getFingerDistance() {
        if (this.touches.length == 2) {
            let ta = this.touches[0];
            let tb = this.touches[1];
            return Math.sqrt((ta.x - tb.x) * (ta.x - tb.x) + (ta.y - tb.y) * (ta.y - tb.y));
        }
        else return 1;
    }

    touchstart(e: TouchEvent, args: T) {
        if (this.touches.length == 0) {
            this.touchDownIssued = false;
            this.numTouches = 0;
            this.touchDownDistance = 0;
            this.touchDownPosition = false;
        }

        for (let i = 0; i < e.touches.length; i++) {
            let new_t = e.touches[i];
            let t = this.getTouchByID(new_t.identifier);
            if (!t) {
                this.touches.push(
                    {
                        id: new_t.identifier,
                        x: new_t.pageX,
                        y: new_t.pageY
                    }
                );
            }
            else {
                t.x = new_t.pageX;
                t.y = new_t.pageY;
            }
        }

        if (!this.touchDownIssued) {
            this.numTouches = Math.max(this.numTouches, this.touches.length);
        }
        // PORQUE?
        //this.events["onTouchDown"](this.getCenterTouchPos(),this.touches);
    }

    touchmove(e: TouchEvent, args: T) {
        for (let i = 0; i < e.changedTouches.length; i++) {
            let new_t = e.changedTouches[i];

            let t = this.getTouchByID(new_t.identifier);
            //alert(t);
            if (t) {
                t.x = new_t.pageX;
                t.y = new_t.pageY;
            }
        }

        let touchPos = this.getCenterTouchPos();

        if (!this.touchDownIssued) {
            this.fireEvent("onTouchDown", touchPos, args);
            this.touchDownIssued = true;
            this.touchDownDistance = this.getFingerDistance();
        }
        else {
            if (this.touches.length == 2 && this.touchDownDistance > 50) {
                let zoomDelta = this.getFingerDistance() / this.touchDownDistance;
                if (zoomDelta) {
                    if (this.events["onTouchZoom"])
                        this.events["onTouchZoom"]({ 
                            pageX: touchPos.x, 
                            pageY: touchPos.y, 
                            delta: zoomDelta,
                            clientX: touchPos.x,
                            clientY: touchPos.y,
                            screenX: touchPos.x,
                            screenY: touchPos.y,
                            button: touchToButton(this.numTouches),
                            buttons: touchToButtons(this.numTouches)
                        }, args);
                }
                this.touchDownDistance = this.getFingerDistance();
            }

            if (this.numTouches <= this.touches.length) {
                this.fireEvent("onTouchMove", touchPos, args);
            }
        }
    }

    touchend(e: TouchEvent, args: T) {
        let touchPos = this.getCenterTouchPos();
        //var touchPos = this.touchDownPosition;
        for (let i = 0; i < e.changedTouches.length; i++) {
            let new_t = e.changedTouches[i];
            let t = this.getTouchByID(new_t.identifier);
            if (t) {
                referenceSafeRemove(this.touches, this.touches.indexOf(t));
            }
        }

        //if(this.touches.length == 0)
        //{
        if (this.numTouches > 0) {
            if (!this.touchDownIssued) {
                this.fireEvent("onTouchDown", touchPos, args);

                this.touchDownIssued = true;
            }

            this.fireEvent("onTouchUp", touchPos, args);

            this.numTouches = 0;
        }

    }

    touchcancel(e: TouchEvent, args: T) {
        this.touchend(e, args);
    }

    touchleave(e: TouchEvent, args: T) {
        this.touchend(e, args);
    }

    getCenterTouchPos() {
        let p = { x: 0, y: 0 };
        if(this.touches.length == 0) return p;

        for (let i = 0; i < this.touches.length; i++) {
            p.x += this.touches[i].x;
            p.y += this.touches[i].y;
        }

        p.x /= this.touches.length;
        p.y /= this.touches.length;
        return p;
    }
}