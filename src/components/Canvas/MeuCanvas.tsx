import { TouchEvent, useEffect } from 'react';
import CanvasControler, { EstadoType } from './CanvasController'
import TouchManager, { CanvasEventFn } from './TouchManager';
//import React, {memo} from 'react'

//import styles from '@/styles/MeuCanvas.module.css'
//import "./MeuCanvas.css"

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
    events: {
        onMouseDown?: CanvasEventFn<T>,
        onMouseUp?: CanvasEventFn<T>,
        onMouseMove?: CanvasEventFn<T>,
        onClick?: CanvasEventFn<T>,
        onContextMenu?: CanvasEventFn<T>,
        onWheel?: CanvasEventFn<T>,
        onTouchStart?: CanvasEventFn<T>,
        onTouchMove?: CanvasEventFn<T>,
        onTouchEnd?: CanvasEventFn<T>,
        onTouchCancel?: CanvasEventFn<T>
    },
    getInitialState: (estado: EstadoType) => void,
    onPropsChange?: (estado: T) => void,
    onDismount?: (estado: T) => void,
    options?: {
        [key: string]: unknown,
        useTouchManager?: boolean,
        preventContextMenu?: boolean,
        contextMenuAsRightClick?: boolean, // Finge que o evento ContextMenu seja um botão direito do mouse
        context?: string,
    }
}) => {

    console.log("Criou o MeuCanvas");

    const { draw, everyFrame, events, getInitialState, onPropsChange, onDismount, options: _options, ...rest } = props

    const defaultOptions = {
        useTouchManager:true,
        preventContextMenu:true,
        contextMenuAsRightClick:true, // Finge que o evento ContextMenu seja um botão direito do mouse
        context:"2d"
    };
    const options = _options ? {...defaultOptions,..._options} : defaultOptions;


    const { doEvent, canvasUseEffect, canvasRef } = CanvasControler(draw, everyFrame,getInitialState, onPropsChange, onDismount, options)

    useEffect(() => {
        return canvasUseEffect();
    }, [canvasUseEffect]);
    
    let myListeners: { [key: string]: CanvasEventFn<T> } = {
        onContextMenu: (_e) => {
            const e = _e as unknown as MouseEvent;

            if(options.preventContextMenu)
                e.preventDefault(); // evitar abrir a janela contextMenu ao clicar o botão direito

            if(options.contextMenuAsRightClick && events.onClick)
            {
                //e.button = 2;
                //e.buttons = e.buttons | 2;
                //return doEvent(events.onClick,e);
                return doEvent(events.onClick, {
                    ...e,
                    button: 2,
                    buttons: e.buttons | 2
                } as unknown as MouseEvent);
            }
            if(events.onContextMenu) 
                return doEvent(events.onContextMenu,e);
        }
    };

    const touchManager = new TouchManager<T>();

    if(options.useTouchManager)
    myListeners = {...myListeners,...{
        onTouchStart: (e, estado) => { touchManager.touchstart(e as TouchEvent, estado); return null; },
        onTouchMove: (e, estado) => { touchManager.touchmove(e as TouchEvent, estado); return null; },
        onTouchEnd: (_e, estado) => { 
            const e = _e as unknown as TouchEvent;
            // Impedir um evento de long tap?
            if(options.preventContextMenu)
                e.preventDefault();

            touchManager.touchend(e, estado); 
            return null;
        },
        onTouchCancel: (e, estado) => { 
            touchManager.touchcancel(e as TouchEvent, estado); 
            return null;
        }
    }};

    for (const k in events) {
        if(!(k in myListeners))
        myListeners[k] = (e) => { 
            if(k in events && typeof k === "string") {
                return doEvent(events[k as keyof typeof events]!, e);
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
        touchManager.addEventListener("onTouchDown", (e, estado) => myListeners.onMouseDown ? myListeners.onMouseDown(e, estado) : null);
        touchManager.addEventListener("onTouchMove", (e, estado) => myListeners.onMouseMove ? myListeners.onMouseMove(e, estado) : null);
        touchManager.addEventListener("onTouchUp", (e, estado) => {
            if(myListeners.onMouseUp) myListeners.onMouseUp(e, estado);
            if(myListeners.onClick) return myListeners.onClick(e, estado);
            return null;
        });
        touchManager.addEventListener("onTouchZoom", (e, estado) => myListeners.doZoom ? myListeners.doZoom(e, estado) : null);
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