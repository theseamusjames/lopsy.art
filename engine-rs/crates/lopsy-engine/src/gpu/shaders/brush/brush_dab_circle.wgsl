//#include brush_dab_header

fn computeDab(fragPos: vec2<f32>, center: vec2<f32>, jSize: f32, jOpacity: f32, jAngle: f32) -> vec4<f32> {
    let radius = jSize * 0.5;
    let stamp = circleStamp(fragPos, center, radius);
    if (stamp < 0.0) { discard; }
    let a = stamp * params.u_flow * jOpacity;
    return vec4<f32>(params.u_brushColor.rgb * a, a);
}

//#include brush_dab_footer
