// https://blog.bitsrc.io/using-non-ssr-friendly-components-with-next-js-916f38e8992c
import dynamic from "next/dynamic"
import React from "react"

const NonSSRWrapper = (props: {children: React.ReactNode}) => (
    <React.Fragment>{props.children}</React.Fragment> 
) 

export default dynamic(() => Promise.resolve(NonSSRWrapper), { 
    ssr: false 
})