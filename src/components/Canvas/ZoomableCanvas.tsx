import MeuCanvas from "./MeuCanvas";
import { mesclarEstado, pageToCanvas, canvasToPage, EstadoType } from "./CanvasController";
import { CanvasEventFn, CanvasEventType, normalizeWheel } from "./TouchManager";
import { MouseEvent, WheelEvent } from "react";

export type ZoomEstadoType = EstadoType & {
    span: {x: number, y: number},
    spanningStart: {x: number, y: number},
    mouse: {
        pageX: number,
        pageY: number,
        x: number,
        y: number,
        left: number,
        middle: number,
        right: number
    },
    spanning: boolean,
    spanned: boolean,
    scale: number,
    spanEnabled: boolean,
    zoomEnabled: boolean
};

/** Transformar de posição local no canvas para página */
export function zoomCanvasToPage(p: {x: number, y: number}, offsetLeft: number, offsetTop: number, span: {x: number, y: number}, scale: number)
{
    const tp = {x:(p.x - span.x) * scale,y:(p.y - span.y) * scale};

    return canvasToPage(tp,offsetLeft,offsetTop);
}

/** Transformar de posição da página para local no canvas */
export function pageToZoomCanvas(p: {x: number, y: number}, offsetLeft: number, offsetTop: number, span: {x: number, y: number}, scale: number)
{
    const tp = pageToCanvas(p,offsetLeft,offsetTop);

    return {x:tp.x / scale + span.x,y:tp.y / scale + span.y};
}

export function doZoomWithCenter(estado: ZoomEstadoType, newScale: number, center: {x: number, y: number})
{
    let scale = estado.scale;
    let span = estado.span;
    let mouse = estado.mouse;
    let offLeft = estado.offsetLeft;
    let offTop = estado.offsetTop;

    let before = pageToZoomCanvas({
        x:center.x,
        y:center.y
    },offLeft,offTop,span,scale);

    //scale *= delta;
    scale = newScale;

    let after = pageToZoomCanvas({
        x:center.x,
        y:center.y
    },offLeft,offTop,span,scale);

    const newSpan = {
        x: span.x - (after.x - before.x),
        y: span.y - (after.y - before.y)
    };

    const newMousePos = pageToZoomCanvas({x:mouse.pageX,y:mouse.pageY},offLeft,offTop,newSpan,scale); // Atualiza o mouse com a nova transformação

    return {
        scale:scale,
        span:newSpan,
        mouse: {
            ...mouse,
            x: newMousePos.x,
            y: newMousePos.y
        }
    };
}

/**
 * Zoomable Canvas
 * Permite mover para os lados e dar zoom no canvas
 * @param draw Função de desenho normal
 * @param uidraw Função que irá desenhar depois de tudo, sem escala nem zoom
 * @param events Objeto que deve conter quais eventos deseja controlar (ex: onMouseDown). O evento receberá como parâmetro (e,estado) onde
 * estado é um objeto contendo informações que podem ser alteradas com a função mesclarEstado do CanvasControler
 * @param getInitialState Função que inicializa o estado
 * @param options Opções gerais
 * @param   options.DEBUG exibe informações sobre o canvas
 * @param   options.spanButton "any" controla qual botão realiza o span: "any", "left", "middle" ou "right"
 * @param   options.maxZoomScale 20.0 O máximo que pode dar zoom
 * @param   options.minZoomScale 0.25 O mínimo que pode dar zoom
 * @param   options.spanEnabled true Se é possível realizar span
 * @param   options.zoomEnabled true Se é possível realizar zoom
 * @param   options.useTouchManager true // TouchManager simplifica o uso do toque re-interpretando como Mouse
 * @param   options.preventContextMenu true // Cancelar eventos de abrir o menu do botão direito ou long-tap
 * @param   options.context "2d" // contexto de desenho do canvas
 * 
 */
const ZoomableCanvas = <T extends ZoomEstadoType,>(props: {
    draw: (context: CanvasRenderingContext2D | null, estado: T) => void,
    everyFrame?: (estado: T) => Partial<T> | false | null | undefined,
    uidraw?: (context: CanvasRenderingContext2D | null, estado: T) => void,
    events?: {
        onMouseDown?: CanvasEventFn<T>,
        onMouseMove?: CanvasEventFn<T>,
        onMouseUp?: CanvasEventFn<T>,
        onWheel?: CanvasEventFn<T>,
        onClick?: CanvasEventFn<T>,
        onMouseLeave?: CanvasEventFn<T>,
        onMouseEnter?: CanvasEventFn<T>,
        onSpan?: CanvasEventFn<T>
    },
    onPropsChange?: (estado: T) => void,
    onDismount?: (estado: T) => void,
    options?: {
        [key: string]: unknown,
        DEBUG?: boolean,
        spanButton?: "any" | "left" | "middle" | "right",
        maxZoomScale?: number,
        minZoomScale?: number,
        spanEnabled?: boolean,
        zoomEnabled?: boolean,
        useTouchManager?: boolean,
        preventContextMenu?: boolean,
        context?: string
        initialState?: Partial<T>
    }
}) => {

    console.log("Criou o ZoomableCanvas");
    const { uidraw, draw, everyFrame, events, onPropsChange, onDismount, options:_options, ...rest } = props

    const defaultOptions: typeof _options = {
        DEBUG: false,
        spanButton:"any",
        maxZoomScale: 20.0,
        minZoomScale: 0.25,
        spanEnabled: true,
        zoomEnabled: true
    };
    const options = _options ? {...defaultOptions,..._options} : defaultOptions;
    options.initialState = {
        ...(_options?.initialState ? _options.initialState : {}),
        mouse:{pageX:0,pageY:0,x:0,y:0,left:0,middle:0,right:0},
        span:{x:0,y:0},
        spanning:false,
        scale:1.0,
        spanningStart:{x:0,y:0},
        spanned:false,
        spanEnabled:options.spanEnabled,
        zoomEnabled:options.zoomEnabled        
    } as T;

    const spanButton = options.spanButton;
    const DEBUG = options.DEBUG;
    const maxZoomScale = options.maxZoomScale!;
    const minZoomScale = options.minZoomScale!;
    // Obtêm o mouse em coordenadas locais
    const getMouse = (e: MouseEvent, estado: T) => 
    {
        const umouse = pageToZoomCanvas({
            x:e.pageX,
            y:e.pageY
        }, estado.offsetLeft as number,estado.offsetTop as number,estado.span as {x: number, y: number},estado.scale as number);


        return {
            pageX:e.pageX,
            pageY:e.pageY,
            x:umouse.x,
            y:umouse.y,
            left: e.buttons & 1,
            middle: e.buttons & 4,
            right: e.buttons & 2
        };
    };

    // Desenhar ou não algumas informações sobre a tela e o mouse
    let DEBUG_N = 0;
    let DEBUG_TXTN = 0;
    let DEBUG_TXT = "";
    let DEBUG_TXT2 = "";
    let DEBUG_TXT2N = 0;
    let DEBUG_TXT3 = "";
    let DEBUG_TXT3N = 0;
    let DEBUG_TXT4 = "";
    let DEBUG_TXT4N = 0;
    // Função que desenha tudo
    const mydraw = (ctx: CanvasRenderingContext2D | null, estado: T) => {
        if(!ctx) return;

        const w = estado.width;
        const h = estado.height;

        ctx.clearRect(0, 0, w,h);

        

        ctx.save();

        ctx.scale(estado.scale,estado.scale);
        ctx.translate(-estado.span.x,-estado.span.y);
        
        if(DEBUG)
        {
            const b = 32
            ctx.fillStyle = '#00ff00';
            ctx.fillRect(0, 0, w, b);
            ctx.fillRect(0, h-b, w, b);
            
            ctx.fillRect(0, 0, b, h);
            ctx.fillRect(w-b, 0, b, h);

            if(estado.mouse)
            {
                ctx.fillStyle = "#" + 
                (estado.mouse.left ? "ff" : "00") +
                (estado.mouse.middle ? "ff" : "00") +
                (estado.mouse.right ? "ff" : "00");

                ctx.fillRect(estado.mouse.x-b/2,estado.mouse.y-b/2,b,b);
            }
        }
        draw(ctx,estado);

        ctx.restore();

        if(DEBUG)
        {    
            const b = 32
            ctx.fillStyle = '#0000ff';
            ctx.fillRect(0, 0, w, b);
            ctx.fillRect(0, h-b, w, b);
            //ctx.fillStyle = '#00ff00';
            ctx.fillRect(0, 0, b, h);
            ctx.fillRect(w-b, 0, b, h);   

            ctx.fillStyle = '#ffffff';
            ctx.font = "30px Arial";
            ctx.fillText("Drawed:"+DEBUG_N, 10, 25);
            DEBUG_N++;

            ctx.fillText("Changes:"+estado._changes, 200, 25);
            ctx.fillText(DEBUG_TXT, 10, 80);
            ctx.fillText(DEBUG_TXT2, 10, 80+50);
            ctx.fillText(DEBUG_TXT3, 10, 80+100);
            ctx.fillText(DEBUG_TXT4, 10, 80+150);
        }

        if(uidraw)
        uidraw(ctx,estado);
    };

    const isSpanningClick = (e: MouseEvent, estado: T) => {
        const spanningClick = estado.spanEnabled &&
            ((spanButton == "any") ||
            (spanButton == "left" && e.button == 0) ||
            (spanButton == "middle" && e.button == 1) ||
            (spanButton == "right" && e.button == 2));
        return spanningClick;
    }

    // ############################
    //          Eventos
    // ############################
    // onMouseDown - Clicou o mouse
    // onMouseMove - Moveu o mouse
    // onMouseUp - Soltou o mouse
    // onWheel e doZoom - Controlar o zoom
    const onMouseDown: CanvasEventFn<T> = (_e, estado) => {
        const e = _e as unknown as MouseEvent;
        
        if(DEBUG)
        {
            DEBUG_TXTN++
            DEBUG_TXT = DEBUG_TXTN+" Down "+e.button+" "+e.pageX+","+e.pageY;
        }
        const mouse = getMouse(e,estado);
        const spanning = isSpanningClick(e,estado);

        mesclarEstado(estado, {
            mouse:mouse,
            spanning: spanning,
            spanned:false,
            spanningStart:mouse
        });

        if(!spanning && events?.onMouseDown) 
        mesclarEstado(estado,events.onMouseDown(e,estado));

        return null;
    };

    const onMouseMove: CanvasEventFn<T> = (_e, estado) => {
        const e = _e as unknown as MouseEvent;

        if(DEBUG) DEBUG_TXT += ".";

        const mouse = getMouse(e,estado);

        if(estado.spanEnabled)
        {
            if(estado.spanning)
            {
                //const span = estado.span;
                //span.x -= mouse.x - estado.spanningStart.x;
                //span.y -= mouse.y - estado.spanningStart.y;
                const span = {
                    x: estado.span.x - (mouse.x - estado.spanningStart.x),
                    y: estado.span.y - (mouse.y - estado.spanningStart.y)
                };

                estado.span = span;
                mesclarEstado(estado,{
                    mouse:getMouse(e,estado),
                    span:span,
                    spanned:true
                });

                if(events?.onSpan) mesclarEstado(estado,events.onSpan(e,estado));
            }
            else
            {
                mesclarEstado(estado,{
                    mouse:getMouse(e,estado),
                    spanning: false,
                    spanned: false
                });
            }
        }
        else
        {
            mesclarEstado(estado,{
                mouse:getMouse(e,estado),
                spanning: false,
                spanned: false
            });
        }

        if(!estado.spanning && events?.onMouseMove) 
        mesclarEstado(estado,events.onMouseMove(e,estado));

        return null;
    };

    const onMouseUp: CanvasEventFn<T> = (_e, estado) => {
        const e = _e as unknown as MouseEvent;

        if(DEBUG)
        {
            DEBUG_TXT2N++
            DEBUG_TXT2 = DEBUG_TXT2N+" Up "+e.button+" "+e.pageX+","+e.pageY;
        }
        const mouse = getMouse(e,estado);

        const wasSpanning = estado.spanning;
        const wasSpanned = estado.spanned;

        mesclarEstado(estado,{
            mouse:mouse,
            spanning:false
        });

        if(!wasSpanning && events?.onMouseUp) 
        mesclarEstado(estado,events.onMouseUp(e,estado));

        if(!wasSpanning || (wasSpanning && !wasSpanned))
        {
            // applyclick only if the span button is the same as this click event button
            const spanningClick = isSpanningClick(e,estado);

            if(spanningClick && events?.onClick)
            {
                if(events.onMouseDown) mesclarEstado(estado,events.onMouseDown(e,estado)); // Simulate all events, because they where not propagated
                if(events.onMouseUp) mesclarEstado(estado,events.onMouseUp(e,estado));
                if(events.onClick) mesclarEstado(estado,events.onClick(e,estado));
            }
        }

        return null;
    };

    const doZoom: CanvasEventFn<T> = (_e, estado) => {  
        if(!estado.zoomEnabled) return;
        const e = _e as unknown as {delta: number, pageX: number, pageY: number} & CanvasEventType;

        let newScale = estado.scale * e.delta;
        newScale = Math.max(Math.min(newScale,maxZoomScale),minZoomScale);
        mesclarEstado(estado,doZoomWithCenter(estado,newScale,{
            x:e.pageX,
            y:e.pageY
        }));

        if(events?.onSpan) mesclarEstado(estado,events.onSpan(e,estado));

        return null;
    };

    const onWheel: CanvasEventFn<T> = (_e, estado) => {
        const e = _e as unknown as WheelEvent;

        const wheelDelta = normalizeWheel(e);
        const amount = 1.0 - Math.max(Math.min(wheelDelta.pixelY/200.0,0.2),-0.2);
        const mouse = estado.mouse;

        return doZoom({
            ...e,
            delta: amount,
            pageY: mouse.pageY,
            pageX: mouse.pageX,
        }, estado);
    };
    
    const onClick: CanvasEventFn<T> = (_e, estado) => {
        const e = _e as unknown as MouseEvent;

        if(DEBUG)
        {
            DEBUG_TXT3N++;
            DEBUG_TXT3 = DEBUG_TXT3N+" Click "+e.button+" "+e.pageX+","+e.pageY;
        }
        const spanningClick = isSpanningClick(e,estado);

        if(!spanningClick && events?.onClick)
        {
            return events.onClick(e,estado);
        }
    };

    const onMouseLeave: CanvasEventFn<T> = (_e, estado) => {
        const e = _e as unknown as MouseEvent;

        const mouse = getMouse(e,estado);
        mesclarEstado(estado,{mouse:mouse});

        if(events?.onMouseLeave) return events.onMouseLeave(e,estado);
    }

    const onMouseEnter: CanvasEventFn<T> = (_e, estado) => {
        const e = _e as unknown as MouseEvent;

        const mouse = getMouse(e,estado);
        mesclarEstado(estado,{mouse:mouse});

        if(events?.onMouseEnter) return events.onMouseEnter(e,estado);
    }
    
    let myListeners: { [key: string]: CanvasEventFn<T> } = {
        onMouseDown:onMouseDown,
        onMouseMove:onMouseMove,
        onMouseUp:onMouseUp,
        onWheel:onWheel,
        doZoom:doZoom,
        onClick:onClick,
        onMouseLeave: onMouseLeave,
        onMouseEnter: onMouseEnter
    };

    for (const k in events) {
        if(!(k in myListeners))
        if(k in events && typeof k === "string") {
            myListeners[k] = events[k as keyof typeof events]!;
        }
    }

    return <MeuCanvas 
        draw={mydraw}
        everyFrame={everyFrame}
        onDismount={onDismount}
        onPropsChange={onPropsChange}
        events={myListeners}
        options={options} 
    />;
};
  
export default ZoomableCanvas;