struct VSOut {
    float4 pos : SV_Position;
    float2 uv  : TEXCOORD0;
};

// Full-screen triangle in NDC; RSSetViewports clips to the webcam dest rect.
VSOut vs_main(uint id : SV_VertexID) {
    VSOut o;
    float2 positions[3] = { float2(-1, -1), float2(3, -1), float2(-1, 3) };
    float2 uvs[3]       = { float2(0, 1),   float2(2, 1),   float2(0, -1) };
    o.pos = float4(positions[id], 0, 1);
    o.uv  = float2(uvs[id].x, 1.0 - uvs[id].y);
    return o;
}

Texture2D tex0 : register(t0);
SamplerState samp0 : register(s0);

float4 ps_main(VSOut i) : SV_Target0 {
    return tex0.Sample(samp0, i.uv);
}
