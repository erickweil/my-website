"use client";

import { mesclarEstado } from "@/components/Canvas/CanvasController";
import ZoomableCanvas, { ZoomEstadoType } from "@/components/Canvas/ZoomableCanvas";
import NonSSRWrapper from "@/components/nonSSRWrapper";
import { UIEvent, useEffect, useRef, useState } from "react";

type MapaEstado = ZoomEstadoType & {
    px: number,
    py: number,
    cliques: number,
    mapaImg: HTMLImageElement | null,
    mapaCalibracao: { lat: number, lng: number, x: number, y: number }[]
};

function mapaToImgPixels(lat: number, lng: number, calibracao: { lat: number, lng: number, x: number, y: number }[]) {
    if(calibracao.length < 2) {
        console.warn("Calibration data is insufficient to convert lat/lng to image pixels.");
        return { x: 0, y: 0 };
    }
    
    // Usar os dois pontos de calibração para calcular a posição relativa
    const p1 = calibracao[0];
    const p2 = calibracao[1];

    const latRange = p2.lat - p1.lat;
    const lngRange = p2.lng - p1.lng;
    const xRange = p2.x - p1.x;
    const yRange = p2.y - p1.y;

    const latPercent = (lat - p1.lat) / latRange;
    const lngPercent = (lng - p1.lng) / lngRange;

    return {
        x: p1.x + lngPercent * xRange,
        y: p1.y + latPercent * yRange
    };
}

export default function MapaIfro() {
    const [locationAllowed, setLocationAllowed] = useState<boolean>(false);
    const locationRef = useRef<GeolocationPosition | null>(null);
    const mapaImgRef = useRef<HTMLImageElement | null>(null);

    useEffect(() => {
        // Carrega a imagem do mapa
        const img = new Image();
        img.src = "https://i.imgur.com/rplQLeN.png";
        img.onload = () => {
            console.log("Mapa image loaded successfully.");
            mapaImgRef.current = img;
        };
        img.onerror = (error) => {
            console.error("Error loading mapa image:", error);
        };
    }, []);

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
                    px: 0, 
                    py: 0,
                    cliques: 0,
                    mapaImg: null,
                    mapaCalibracao: [
                        { lat: -12.6976635, lng: -60.1674091, x: 13, y: 17 }, // Canto superior esquerdo do mapa
                        { lat: -12.7576233, lng: -60.0944188, x: 862, y: 732 }, // Canto inferior direito do mapa
                        //{ lat: -12.6976635, lng: -60.1674091, x: 32, y: 43 }, // Canto superior esquerdo do mapa
                        //{ lat: -12.7576233, lng: -60.0944188, x: 2178, y: 1850 }, // Canto inferior direito do mapa
                    ]
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

                ctx.clearRect(0, 0, w, h);
                if(estado.mapaImg) {
                    const imgW = estado.mapaImg.width;
                    const imgH = estado.mapaImg.height;
                    //const scale = Math.min(w / imgW, h / imgH); // Escala para caber no canvas
                    //const x = (w - imgW * scale) / 2;
                    //const y = (h - imgH * scale) / 2;
                    //ctx.drawImage(estado.mapaImg, x, y, imgW * scale, imgH * scale);
                    ctx.drawImage(estado.mapaImg, 0, 0, imgW, imgH);
                } else {
                    ctx.fillStyle = "white";
                    ctx.fillRect(0, 0, w, h);
                }

                // Escrever a posição atual no canvas
                if(locationRef.current) {
                    const { latitude, longitude } = locationRef.current.coords;
                    ctx.fillStyle = "black";
                    ctx.font = "20px Arial";
                    ctx.fillText(`Latitude: ${latitude}`, 10, 30);
                    ctx.fillText(`Longitude: ${longitude}`, 10, 60);
                    ctx.fillText(`X: ${estado.px.toFixed(2)}`, 10, 90);
                    ctx.fillText(`Y: ${estado.py.toFixed(2)}`, 10, 120);
                } else {
                    ctx.fillStyle = "red";
                    ctx.font = "20px Arial";
                    ctx.fillText("Aguardando permissão de localização...", 10, 30);
                }

                // Desenhar um 'X' no ponto da localização atual no mapa
                if(estado.px && estado.py) {
                    ctx.strokeStyle = "blue";
                    ctx.lineWidth = 2;
                    ctx.beginPath();
                    // X
                    ctx.moveTo(estado.px - 10, estado.py - 10);
                    ctx.lineTo(estado.px + 10, estado.py + 10);
                    ctx.moveTo(estado.px + 10, estado.py - 10);
                    ctx.lineTo(estado.px - 10, estado.py + 10);
                    ctx.stroke();
                }

                ctx.fillStyle = "black";
                ctx.font = "20px Arial";
                ctx.fillText(`Cliques: ${estado.cliques || 0}`, w-120, 30);
            }}
            everyFrame={(estado) => {
                if(locationRef.current) {
                    const { latitude, longitude } = locationRef.current.coords;
                    
                    const imgCoords = mapaToImgPixels(latitude, longitude, estado.mapaCalibracao);
                    if(imgCoords.x !== estado.px || imgCoords.y !== estado.py) {
                        console.log("Updating location in state:", { latitude, longitude });
                        
                        mesclarEstado(estado, {
                            px: imgCoords.x,
                            py: imgCoords.y
                        });
                    }
                }
                if(mapaImgRef.current && !estado.mapaImg) {
                    console.log("Setting mapa image in state.");
                    mesclarEstado(estado, {
                        mapaImg: mapaImgRef.current
                    });
                }

                return null;
            }}
			events={{
				onClick: (e, estado) => {
                    return {
                        cliques: estado.cliques + 1
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