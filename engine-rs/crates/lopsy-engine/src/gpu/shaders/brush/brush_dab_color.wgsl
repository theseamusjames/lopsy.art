//#include brush_dab_header

fn computeDab(fragPos: vec2<f32>, center: vec2<f32>, jSize: f32, jOpacity: f32, jAngle: f32) -> vec4<f32> {
    let tipUV = computeTipUV(fragPos, center, jSize, jAngle);
    if (tipUVOutOfBounds(tipUV)) { discard; }
    let tipColor = textureSampleLevel(u_brushTip, u_brushTip_sampler, tipUV, 0.0);
    return tipColor * (params.u_flow * jOpacity);
}

//#include brush_dab_footer
