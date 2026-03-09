"use client";

import { EstadoType, mesclarEstado } from "@/components/Canvas/CanvasController";
import { CanvasEventType } from "@/components/Canvas/TouchManager";
import ZoomableCanvas, { ZoomEstadoType } from "@/components/Canvas/ZoomableCanvas";
import NonSSRWrapper from "@/components/nonSSRWrapper";
import { useEffect, useRef, useState } from "react";

type MapaEstado = ZoomEstadoType & {
    latitude?: number,
    longitude?: number,
    cliques?: number
};

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

    const mydraw = (ctx: CanvasRenderingContext2D | null, estado: MapaEstado) => {
        if(!ctx) {
            console.warn("Canvas context is null, cannot draw.");
            return;
        }

        console.log("Drawing canvas!");
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

    const myGetInitialState = (estado: MapaEstado) => {
        console.log("Getting initial state for canvas...");
        mesclarEstado(estado, {
            latitude: 0, 
            longitude: 0,
            cliques: 0
        });
    };

    const onPropsChange = (estado: MapaEstado) => {
        console.log("Canvas props changed, current state:", estado);
    };

    const onDismount = (estado: MapaEstado) => {
        console.log("Canvas is being dismounted, final state:", estado);
    };

    const everyFrame = (estado: MapaEstado) => {
        if(locationRef.current) {
            const { latitude, longitude } = locationRef.current.coords;
            //if(!estado.location)
            //estado.location = { latitude, longitude };
            if(estado.latitude !== latitude || estado.longitude !== longitude) {
                console.log("Updating location in state:", { latitude, longitude });
                mesclarEstado(estado, {
                    latitude: latitude,
                    longitude: longitude
                });
            }
        }

        return null;
    };

    const onClick = (e: CanvasEventType, estado: MapaEstado) => {
        return {
            cliques: (estado.cliques as number || 0) + 1
        }
    };

    return (
        <NonSSRWrapper>
        <ZoomableCanvas<MapaEstado>
            getInitialState={myGetInitialState}
			onPropsChange={onPropsChange}
			draw={mydraw}
			options={{
                useTouchManager: false,
                spanButton: "any"
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