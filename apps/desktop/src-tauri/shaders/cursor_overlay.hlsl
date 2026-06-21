struct VSOut {
    float4 pos : SV_Position;
    float2 uv  : TEXCOORD0;
};

cbuffer Params : register(b0) {
    float4 rect;
    float2 outSize;
    float  alphaMul;
    float  pad;
};

VSOut vs_main(uint id : SV_VertexID) {
    VSOut o;
    float2 uv_coords[3] = { float2(0, 1), float2(2, 1), float2(0, -1) };
    float2 uv = uv_coords[id];
    float px = rect.x + uv.x * rect.z;
    float py = rect.y + uv.y * rect.w;
    o.pos = float4(
        (px / outSize.x) * 2.0 - 1.0,
        1.0 - (py / outSize.y) * 2.0,
        0.0,
        1.0
    );
    o.uv = float2(uv.x, 1.0 - uv.y);
    return o;
}

Texture2D tex0 : register(t0);
SamplerState samp0 : register(s0);

float4 ps_main(VSOut i) : SV_Target0 {
    float4 c = tex0.Sample(samp0, i.uv);
    c.a *= alphaMul;
    return c;
}
