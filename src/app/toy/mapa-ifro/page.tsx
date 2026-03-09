"use client";

import { EstadoType, mesclarEstado } from "@/components/Canvas/CanvasController";
import MeuCanvas from "@/components/Canvas/MeuCanvas";
import { CanvasEventType } from "@/components/Canvas/TouchManager";
import NonSSRWrapper from "@/components/nonSSRWrapper";
import { useEffect, useRef, useState } from "react";

export default function MapaIfro() {
    const [locationAllowed, setLocationAllowed] = useState<boolean>(false);
    const locationRef = useRef<GeolocationPosition | null>(null);

    useEffect(() => {
        // Solicita permissão para acessar a localização e começa a monitorar as mudanças de posição
        let watchId: number | null = null;
        let permissionStatus: PermissionStatus | null = null;
        const effectFn = async () => {
            if(!permissionStatus) {
                try {
                    permissionStatus = await navigator.permissions.query({ name: 'geolocation' });
                    if (permissionStatus.state === 'granted') {
                        console.log("Geolocation permission granted.");
                        setLocationAllowed(true);
                    } else if (permissionStatus.state === 'prompt') {
                        console.log("Geolocation permission prompt will be shown.");
                        setLocationAllowed(true);
                    } else {
                        throw new Error("Geolocation permission denied.");
                    }
                    permissionStatus.onchange = () => {
                        console.log("Geolocation permission state changed to:", permissionStatus?.state);
                    };
                } catch (error) {
                    console.error("Error checking geolocation permission:", error);
                    setLocationAllowed(false);
                    return;
                }
            }
            
            if(!locationAllowed) {
                console.warn("Geolocation permission not granted. Cannot watch position.");
                return;
            }

            try {
                watchId = navigator.geolocation.watchPosition((position) => {
                    //console.log("Current position:", position.coords, position.timestamp);
                    locationRef.current = position;
                }, (error) => {
                    console.error("Error getting location:", error);
                }, {
                    enableHighAccuracy: true
                });
            } catch (error) {
                console.error("Error fetching location:", error);
            }
        };
        effectFn();
        // Limpa o watch quando o componente for desmontado
        return () => {
            if (watchId !== null) {
                navigator.geolocation.clearWatch(watchId);
            }
            if (permissionStatus) {
                permissionStatus.onchange = null;
            }
        };        
    }, [locationAllowed]);

    const mydraw = (ctx: RenderingContext | null, estado: EstadoType) => {
        console.log("Drawing canvas!");
        if(!ctx || !("fillRect" in ctx)) return;

        const w = ctx.canvas.width;
        const h = ctx.canvas.height;

        ctx.fillStyle = "black";
        ctx.fillRect(0, 0, w, h);

        // Escrever a posição atual no canvas
        if(estado.latitude && estado.longitude) {
            ctx.fillStyle = "white";
            ctx.font = "20px Arial";
            ctx.fillText(`Latitude: ${(estado.latitude as number)}`, 10, 30);
            ctx.fillText(`Longitude: ${(estado.longitude as number)}`, 10, 60);
        } else {
            ctx.fillStyle = "red";
            ctx.font = "20px Arial";
            ctx.fillText("Aguardando permissão de localização...", 10, 30);
        }
    };

    const myGetInitialState = (estado: EstadoType) => {
        console.log("Getting initial state for canvas...");
        mesclarEstado(estado, {
            latitude: 0, 
            longitude: 0,
            cliques: 0
        });
    };

    const onPropsChange = (estado: EstadoType) => {
        console.log("Canvas props changed, current state:", estado);
    };

    const onDismount = (estado: EstadoType) => {
        console.log("Canvas is being dismounted, final state:", estado);
    };

    const everyFrame = (estado: EstadoType) => {
        let result = {};
        if(locationRef.current) {
            const { latitude, longitude } = locationRef.current.coords;
            //if(!estado.location)
            //estado.location = { latitude, longitude };
            if(estado.latitude !== latitude || estado.longitude !== longitude) {
                console.log("Updating location in state:", { latitude, longitude });
                result = {
                    ...result,
                    latitude: latitude,
                    longitude: longitude
                };
            }
        }

        return result;
    };

    const onClick = (e: CanvasEventType, estado: EstadoType) => {
        return {
            cliques: (estado.cliques as number || 0) + 1
        }
    };

    return (
        <NonSSRWrapper>
        <MeuCanvas		
        // <ZoomableCanvas	
            getInitialState={myGetInitialState}
			onPropsChange={onPropsChange}
			draw={mydraw}
			options={{
                useTouchManager: false
            }}
			onDismount={onDismount}
			everyFrame={everyFrame}
			events={{
				onClick: onClick,
				//onKeyPress:onKeyPress,
				//onKeyDown:onKeyDown,
				//onKeyUp:onKeyUp,
				//onSpan: onSpan
			}}
        />
        </NonSSRWrapper>
    );
}