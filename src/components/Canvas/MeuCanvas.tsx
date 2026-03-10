import { DOMAttributes, EventHandler, MouseEvent, SyntheticEvent, TouchEvent, UIEvent, useEffect, WheelEvent } from 'react';
import CanvasControler, { CanvasEventFn, EstadoType } from './CanvasController'
import TouchManager from './TouchManager';
//import React, {memo} from 'react'

//import styles from '@/styles/MeuCanvas.module.css'
//import "./MeuCanvas.css"

type CanvasEventHandlers = Omit<DOMAttributes<HTMLCanvasElement>, "children" | "dangerouslySetInnerHTML">;
type ExtractEventType<T> = T extends (event: infer E) => void ? E : UIEvent;
export type MyCanvasEventHandlers<T extends EstadoType> = {
    [K in keyof CanvasEventHandlers]?: CanvasEventFn<ExtractEventType<Required<CanvasEventHandlers>[K]>, T>
} & {
    doZoom?: CanvasEventFn<{delta: number, pageX: number, pageY: number} & WheelEvent<HTMLCanvasElement>, T>,
    onSpan?: CanvasEventFn<UIEvent, T>
};

/**
 * Meu Canvas,
 * Permite que desenhe em um canvas, gerenciando estado e eventos de mouse e toque
 * @param draw Função de desenho normal
 * @param events Objeto que deve conter quais eventos deseja controlar (ex: onMouseDown). O evento receberá como parâmetro (e,estado) onde
 * estado é um objeto contendo informações que podem ser alteradas com a função mesclarEstado do CanvasControler
 * @param getInitialState Função que inicializa o estado
 * @param options Opções gerais
 * @param options.useTouchManager true TouchManager simplifica o uso do toque re-interpretando como Mouse
 * @param options.preventContextMenu true Cancelar eventos de abrir o menu do botão direito ou long-tap
 * @param options.context "2d" contexto de desenho do canvas
 */
const MeuCanvas = <T extends EstadoType,>(props: {
    draw: (context: CanvasRenderingContext2D | null, estado: T) => void,
    everyFrame?: (estado: T) => Partial<T> | false | null | undefined,
    // events: {
    //     onMouseDown?: CanvasEventFn<T>,
    //     onMouseUp?: CanvasEventFn<T>,
    //     onMouseMove?: CanvasEventFn<T>,
    //     onClick?: CanvasEventFn<T>,
    //     onContextMenu?: CanvasEventFn<T>,
    //     onWheel?: CanvasEventFn<T>,
    //     onTouchStart?: CanvasEventFn<T>,
    //     onTouchMove?: CanvasEventFn<T>,
    //     onTouchEnd?: CanvasEventFn<T>,
    //     onTouchCancel?: CanvasEventFn<T>
    // },
    events?: MyCanvasEventHandlers<T>,
    onPropsChange?: (estado: T) => void,
    onDismount?: (estado: T) => void,
    options?: {
        [key: string]: unknown,
        useTouchManager?: boolean,
        preventContextMenu?: boolean,
        contextMenuAsRightClick?: boolean, // Finge que o evento ContextMenu seja um botão direito do mouse
        context?: string,
        initialState?: Partial<T>
    }
}) => {

    console.log("Criou o MeuCanvas");

    const { draw, everyFrame, events, onPropsChange, onDismount, options: _options, ...rest } = props

    const defaultOptions = {
        useTouchManager:true,
        preventContextMenu:true,
        contextMenuAsRightClick:true, // Finge que o evento ContextMenu seja um botão direito do mouse
        context:"2d",
    };
    const options = _options ? {...defaultOptions,..._options} : defaultOptions;

    const { doEvent, canvasUseEffect, canvasRef } = CanvasControler(draw, everyFrame, onPropsChange, onDismount, options)

    // Ainda não entendi porque não pode ficar dentro do CanvasController, mas se colocar lá nunca executa
    useEffect(() => {
        return canvasUseEffect();
    }, [canvasUseEffect]);
    
    let myListeners: CanvasEventHandlers & {
        doZoom?: EventHandler<TouchEvent>,
        onSpan?: EventHandler<UIEvent>
    } = {
        onContextMenu: (_e) => {
            const e = _e as unknown as MouseEvent;

            if(options.preventContextMenu)
                e.preventDefault(); // evitar abrir a janela contextMenu ao clicar o botão direito

            if(options.contextMenuAsRightClick && events?.onClick)
            {
                //e.button = 2;
                //e.buttons = e.buttons | 2;
                //return doEvent(events.onClick,e);
                doEvent(events.onClick as CanvasEventFn<SyntheticEvent, T>, {
                    ...e,
                    button: 2,
                    buttons: e.buttons | 2
                } as unknown as MouseEvent);
            } else if(events?.onContextMenu) {
                doEvent(events.onContextMenu as CanvasEventFn<SyntheticEvent, T>,e);
            }
        }
    };

    const touchManager = new TouchManager();

    if(options.useTouchManager)
    myListeners = {...myListeners,...{
        onTouchStart: (e) => touchManager.touchstart(e as TouchEvent),
        onTouchMove: (e) => touchManager.touchmove(e as TouchEvent),
        onTouchCancel: (e) => touchManager.touchcancel(e as TouchEvent),
        onTouchEnd: (_e) => { 
            const e = _e as unknown as TouchEvent;
            // Impedir um evento de long tap?
            if(options.preventContextMenu)
                e.preventDefault();

            touchManager.touchend(e);
        },
    }};

    for (const k in events) {
        if(!(k in myListeners))
        myListeners[k as keyof typeof myListeners] = (e: SyntheticEvent) => { 
            if(k in events) {
                return doEvent(events[k as keyof typeof events]! as CanvasEventFn<SyntheticEvent, T>, e);
            } else {
                return null;
            }
        }
    }
  
    if(options.useTouchManager)
    {
        // TouchManager gerencia para que funcione em ambientes de toque perfeitamente
        // Basicamente o TouchManager faz ficar igual a quando é clique do mouse 
        // 1 toque -> Botão esquerdo
        // 2 toques -> Botão direito
        // 3 toques -> Botão do meio
        // (Especialmente necessário para funcionar o pinch zoom + span)    
        touchManager.addEventListener("onTouchDown", (e) => myListeners.onMouseDown ? myListeners.onMouseDown(e as unknown as MouseEvent<HTMLCanvasElement>) : null);
        touchManager.addEventListener("onTouchMove", (e) => myListeners.onMouseMove ? myListeners.onMouseMove(e as unknown as MouseEvent<HTMLCanvasElement>) : null);
        touchManager.addEventListener("onTouchUp", (e) => {
            if(myListeners.onMouseUp) myListeners.onMouseUp(e as unknown as MouseEvent<HTMLCanvasElement>);
            if(myListeners.onClick) return myListeners.onClick(e as unknown as MouseEvent<HTMLCanvasElement>);
            return null;
        });
        touchManager.addEventListener("onTouchZoom", (e) => myListeners.doZoom ? myListeners.doZoom(e as unknown as TouchEvent) : null);
    }
    
    // Removing custom doZoom listener from canvasListeners to prevent React Error
    const { doZoom, onSpan, ...canvasListeners} = myListeners;
    return <canvas
        tabIndex={0}
        id="canvasInAPerfectWorld" 
        ref={(el) => {
            canvasRef.current.canvas = el
        }}
        {
       ...canvasListeners}
        
        {...rest}    
    />;
}

//export default memo(MeuCanvas)
export default MeuCanvas