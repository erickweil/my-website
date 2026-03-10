"use client";

import { mesclarEstado } from "@/components/Canvas/CanvasController";
import ZoomableCanvas, { ZoomEstadoType } from "@/components/Canvas/ZoomableCanvas";
import NonSSRWrapper from "@/components/nonSSRWrapper";
import { UIEvent, useEffect, useRef, useState } from "react";

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

    return (
        <NonSSRWrapper>
        <ZoomableCanvas<MapaEstado>
            options={{
                useTouchManager: false,
                spanButton: "any",
                // DEBUG: true,
                initialState: {
                    latitude: 0, 
                    longitude: 0,
                    cliques: 0
                }
            }}
			draw={(ctx, estado) => {
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

                ctx.fillStyle = "yellow";
                ctx.font = "20px Arial";
                ctx.fillText(`Cliques: ${estado.cliques || 0}`, w-120, 30);
            }}
            everyFrame={(estado) => {
                if(locationRef.current) {
                    const { latitude, longitude } = locationRef.current.coords;
                    
                    if(estado.latitude !== latitude || estado.longitude !== longitude) {
                        console.log("Updating location in state:", { latitude, longitude });
                        mesclarEstado(estado, {
                            latitude: latitude,
                            longitude: longitude
                        });
                    }
                }

                return null;
            }}
			events={{
				onClick: (e, estado) => {
                    return {
                        cliques: (estado.cliques as number || 0) + 1
                    }
                },
				//onKeyPress:onKeyPress,
				//onKeyDown:onKeyDown,
				//onKeyUp:onKeyUp,
				//onSpan: onSpan
			}}
            onDismount={(estado) => {
                console.log("Canvas is being dismounted, final state:", estado);
            }}
        />
        </NonSSRWrapper>
    );
}