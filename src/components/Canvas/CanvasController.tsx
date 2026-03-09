import { useRef, useEffect } from 'react'
import { CanvasEventFn, CanvasEventType } from './TouchManager';
//import TouchManager from './TouchManager';

// criar um tipo que representa um estado, pode conter qualuer coisa mas devo poder manipular suas chaves
export type EstadoType = {
    [key: string]: unknown,
    _changes?: number // número de mudanças desde a última renderização, para otimizar renderizações
};

/**
 * Função que controla o estado do canvas,
 * sempre que modificar o estado, faça-o com essa função pois assim o canvas saberá quando atualizar
 * @param estado O estado anterior
 * @param novoEstado Objeto com apenas as propriedades que mudaram 
 * (Pode também ser o mesmo objeto do estado anterior)
 */
export function mesclarEstado(estado: EstadoType, novoEstado?: EstadoType | false | null | undefined) {
    // https://stackoverflow.com/questions/171251/how-can-i-merge-properties-of-two-javascript-objects-dynamically
    //setEstado({...estado,...novoEstado});

    if (!novoEstado) return;

    let changed = false;
    for (const k in novoEstado) {
        estado[k] = novoEstado[k];
        changed = true;
    }

    if (changed) estado._changes!++;
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
const CanvasControler = (
    draw: (context: RenderingContext | null, estado: EstadoType) => void,
    everyFrame: ((estado: EstadoType) => EstadoType) | undefined,
    getInitialState: (estado: EstadoType) => void,
    onPropsChange: ((estado: EstadoType) => void) | undefined,
    onDismount: ((estado: EstadoType) => void) | undefined,
    options: {
        context?: string
    } = {}
) => {
    //const [estado,setEstado] = useState(null);
    //if(!estado) setEstado(getInitialState());

    // Usando só useRef pra não causar um re-render toda vez
    // https://www.smashingmagazine.com/2020/11/react-useref-hook/
    const canvasRef = useRef<{canvas: HTMLCanvasElement | null | undefined, estado: EstadoType | null}>({ canvas: null, estado: null });
    if (!canvasRef.current.estado) {
        console.log("SETANDO ESTADO INICIAL...");
        const novoEstado = {
            offsetLeft: 0,
            offsetTop: 0,
            width: window.innerWidth,
            height: window.innerHeight,
            _changes: 1
        };

        getInitialState(novoEstado);

        canvasRef.current.estado = novoEstado;
    }
    else {
        if (onPropsChange) {
            console.log("onPropsChange");
            onPropsChange(canvasRef.current.estado);
        }
    }

    // GetEstado
    // Essa função garante que:
    // - O estado obtido sempre é o mais recente
    //   - Um conflito de mesclagem é evitado por alterar o próprio objeto com novos valores e então realizar o setEstado
    // - Cada mudança de estado mudará apenas o necessário
    const getEstado = () => {
        if (!canvasRef) return {} as EstadoType;

        return canvasRef.current.estado!;
    };

    // Executa o evento e mescla o estado
    const doEvent = (callback: CanvasEventFn<EstadoType>, e: CanvasEventType) => {
        const _estado = getEstado();

        // Pode retornar apenas o que mudou como um novo objeto
        // O mesmo objeto já modificado (Se modificar o mesmo objeto não precisa retornar ele)
        // Um objeto vazio, falso, null ou não retornar.
        const novoEstado = callback(e, _estado!);

        // Em qualquer situação, mesclarEstado faz com que o novoEstado seja aplicado
        // Apenas alterando propriedades no mesmo objeto, sem necessidade de alterar o ref
        mesclarEstado(_estado, novoEstado);

        //setEstado({..._estado}); -- NÃO USAR ESTADO MAIS

        return null;
    };

    const canvasUseEffect = () => {

        console.log("useEffect do CanvasControler")
        const canvas = canvasRef.current.canvas!;
        const context = canvas.getContext((options && options.context) || '2d');

        // Timer
        let animationFrameId: number;

        // Listener de Resize
        const doResize = () => {
            const { top, left } = canvas.getBoundingClientRect();
            const width = window.innerWidth;
            const height = window.innerHeight - top;

            if (canvas.width !== width || canvas.height !== height) {
                const estado = getEstado();

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
            const estado = getEstado();

            // só garante que vai atualizar a cada mudança se o estado for modificado com mesclarEstado
            if (estado._changes) {
                mesclarEstado(estado, {
                    width: canvas.width,
                    height: canvas.height
                    //offsetLeft:canvas.offsetLeft,
                    //offsetTop:canvas.offsetTop
                });

                draw(context, estado);
                estado._changes = 0;
            }

            if (everyFrame)
                mesclarEstado(estado, everyFrame(estado));
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

            if (onDismount) {
                const estado = getEstado();
                onDismount(estado);
            }
        }
    }; //, [draw]); // Só vai re-chamar o useEffect se o draw mudar.

    return { doEvent, canvasUseEffect, canvasRef };
}
export default CanvasControler;