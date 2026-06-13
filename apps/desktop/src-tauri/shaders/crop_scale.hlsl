struct VSOut {
    float4 pos : SV_Position;
    float2 uv  : TEXCOORD0;
};

VSOut vs_main(uint id : SV_VertexID) {
    VSOut o;
    float2 positions[3] = { float2(-1, -1), float2(3, -1), float2(-1, 3) };
    float2 uvs[3]       = { float2(0, 1),   float2(2, 1),   float2(0, -1) };
    o.pos = float4(positions[id], 0, 1);
    o.uv  = uvs[id];
    return o;
}

Texture2D tex0 : register(t0);
SamplerState samp0 : register(s0);

cbuffer Params : register(b0) {
    float4 uvTransform;
};

float4 ps_main(VSOut i) : SV_Target0 {
    float2 srcUV = uvTransform.xy + i.uv * uvTransform.zw;
    return tex0.Sample(samp0, srcUV);
}
