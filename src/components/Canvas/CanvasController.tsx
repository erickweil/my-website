"use client";

import { useRef, useEffect, useCallback, SyntheticEvent } from 'react'

type CanvasControllerOptions<T extends EstadoType> = {
    context?: string,
    initialState?: Partial<T>
};

// criar um tipo que representa um estado, pode conter qualuer coisa mas devo poder manipular suas chaves
export type EstadoType = {
    _changes: number // número de mudanças desde a última renderização, para otimizar renderizações
    width: number,
    height: number,
    offsetLeft: number /*canvas.offsetLeft*/,
    offsetTop: number /*canvas.offsetTop*/
};

export type CanvasEventFn<E extends SyntheticEvent, T> = (e: E, estado: T) => Partial<T> | false | null | undefined;

/**
 * Função que controla o estado do canvas,
 * sempre que modificar o estado, faça-o com essa função pois assim o canvas saberá quando atualizar
 * @param estado O estado anterior
 * @param novoEstado Objeto com apenas as propriedades que mudaram 
 * (Pode também ser o mesmo objeto do estado anterior)
 */
export function mesclarEstado<T extends EstadoType>(estado: Record<string, unknown> & T, novoEstado?: Record<string, unknown> | false | null | undefined) {
    // https://stackoverflow.com/questions/171251/how-can-i-merge-properties-of-two-javascript-objects-dynamically
    //setEstado({...estado,...novoEstado});

    if (!novoEstado) return;

    let changed = false;
    for (const k in novoEstado) {
        if(novoEstado[k] !== undefined) {
            (estado as Record<string, unknown>)[k] = novoEstado[k];
            changed = true;
        }
    }

    if (changed) estado._changes++;
}

/**
@see https://www.pluralsight.com/guides/re-render-react-component-on-window-resize
Currently, our example code is set up to call handleResize as often
as the window resizes. We're setting state and re-rendering for every 
single pixel change as often as the event loop will let us.

But what if there's a good reason to handling the resizing less often
than that? We might want to be less aggressive in our re-rendering for 
performance reasons, such as in the case of a slow or expensive-to-render component.

In such a case, we can debounce the resize handling and thus the re-rendering.
This will mean to throttle or wait between calls to our handleResize function. 
There are solid debounce implementations. Let's add a short and simple one to our example:
*/
// JS
// function debounce(fn, ms) {
//     let timer
//     return _ => {
//         clearTimeout(timer)
//         timer = setTimeout(_ => {
//             timer = null
//             fn.apply(this, arguments)
//         }, ms)
//     };
// }
/**
 * Implementação debounce em TypeScript
 * @param fn - A função que será executada após o tempo de espera.
 * @param ms - O tempo de espera em milissegundos.
 */
function debounce<T extends (...args: unknown[]) => unknown>(fn: T, ms: number) {
    let timer: ReturnType<typeof setTimeout> | null = null;
    return function (this: ThisParameterType<T>, ...args: Parameters<T>) {
        if (timer) clearTimeout(timer);

        timer = setTimeout(() => {
            timer = null;
            fn.apply(this, args);
        }, ms);
    };
}

/** Transformar de posição local no canvas para página */
export function canvasToPage(p: {x: number, y: number}, offsetLeft: number, offsetTop: number) {
    return { x: p.x + offsetLeft, y: p.y + offsetTop };
}

/** Transformar de posição da página para local no canvas */
export function pageToCanvas(p: {x: number, y: number}, offsetLeft: number, offsetTop: number) {
    return { x: p.x - offsetLeft, y: p.y - offsetTop };
}

/**
@see https://medium.com/@pdx.lucasm/canvas-with-react-js-32e133c05258

Canvas Controler, handles resizing and animationframe callbacks
also handles state using useRef only... to prevent re-renders
*/
const CanvasController = <T extends EstadoType,>(
    draw: (context: CanvasRenderingContext2D | null, estado: T) => void,
    everyFrame: ((estado: T) => Partial<T> | false | null | undefined) | undefined,
    onPropsChange: ((estado: T) => void) | undefined,
    onDismount: ((estado: T) => void) | undefined,
    options: CanvasControllerOptions<T> = {}
) => {
    //const [estado,setEstado] = useState(null);
    //if(!estado) setEstado(getInitialState());

    // Usando só useRef pra não causar um re-render toda vez
    // https://www.smashingmagazine.com/2020/11/react-useref-hook/
    const canvasRef = useRef<{canvas: HTMLCanvasElement | null | undefined, estado: T}>({
        canvas: null,
        estado: {
            ...(options.initialState ? options.initialState : {}),
            offsetLeft: 0,
            offsetTop: 0,
            width: window.innerWidth,
            height: window.innerHeight,
            _changes: 1
        } as T
    });
    const drawRef = useRef(draw);
    const everyFrameRef = useRef(everyFrame);
    const onDismountRef = useRef(onDismount);
    const contextType = options.context || '2d';

    useEffect(() => {
        console.log("Options changed, updating refs and calling onPropsChange if canvas is ready...", options);        drawRef.current = draw;
        everyFrameRef.current = everyFrame;
        onDismountRef.current = onDismount;

        if (canvasRef.current.canvas) {
            canvasRef.current.estado._changes++;
            onPropsChange?.(canvasRef.current.estado);
        }
    }, [draw, everyFrame, onPropsChange, onDismount, options]);

    // Executa o evento e mescla o estado
    const doEvent = useCallback((callback: CanvasEventFn<SyntheticEvent, T>, e: SyntheticEvent) => {
        const _estado = canvasRef.current.estado;

        // Pode retornar apenas o que mudou como um novo objeto
        // O mesmo objeto já modificado (Se modificar o mesmo objeto não precisa retornar ele)
        // Um objeto vazio, falso, null ou não retornar.
        const novoEstado = callback(e, _estado!);

        // Em qualquer situação, mesclarEstado faz com que o novoEstado seja aplicado
        // Apenas alterando propriedades no mesmo objeto, sem necessidade de alterar o ref
        mesclarEstado(_estado, novoEstado);

        //setEstado({..._estado}); -- NÃO USAR ESTADO MAIS

        return null;
    }, []);

    const canvasUseEffect = useCallback(() => {
        console.log("UseEffect do canvas, criando contexto e listeners...");
        const canvas = canvasRef.current.canvas;
        if (!canvas) return;

        const context = canvas.getContext(contextType);

        // Timer
        let animationFrameId = 0;

        // Listener de Resize
        const doResize = () => {
            const { top, left } = canvas.getBoundingClientRect();
            const width = window.innerWidth;
            const height = window.innerHeight - top;

            if (canvas.width !== width || canvas.height !== height) {
                const estado = canvasRef.current.estado;

                canvas.width = width;
                canvas.height = height;

                mesclarEstado(estado, {
                    width: width,
                    height: height,
                    offsetLeft: left /*canvas.offsetLeft*/,
                    offsetTop: top /*canvas.offsetTop*/
                });
            }
        };

        const debounceHandleResize = debounce(doResize, 100);
        window.addEventListener("resize", debounceHandleResize);

        // Timer que se auto-registra recursivamente
        const render = () => {
            const estado = canvasRef.current.estado;

            // só garante que vai atualizar a cada mudança se o estado for modificado com mesclarEstado
            if (estado._changes) {
                mesclarEstado(estado, {
                    width: canvas.width,
                    height: canvas.height
                    //offsetLeft:canvas.offsetLeft,
                    //offsetTop:canvas.offsetTop
                });

                drawRef.current(context as (CanvasRenderingContext2D | null), estado);
                estado._changes = 0;
            }

            if (everyFrameRef.current)
                mesclarEstado(estado, everyFrameRef.current(estado));
            // auto-registra novamente
            // TODO: só pedir um AnimationFrame se houve uma mudança mesmo para ser feita.
            animationFrameId = window.requestAnimationFrame(render);
        }

        // Inicia o Timer
        doResize();
        render();

        // Retorna a função que cancela o timer
        return () => {
            window.cancelAnimationFrame(animationFrameId);
            window.removeEventListener("resize", debounceHandleResize);

            if (onDismountRef.current) {
                const estado = canvasRef.current.estado;
                onDismountRef.current(estado);
            }
        }
    }, []);

    return { doEvent, canvasUseEffect, canvasRef };
}
export default CanvasController;