//! GPU crop + scale via D3D11 shaders (no CPU pixel work).

use crate::geometry::FrameLayout;
use windows::core::Interface;
use windows::Graphics::DirectX::Direct3D11::IDirect3DSurface;
use windows_capture::d3d11::SendDirectX;
use windows::Win32::Graphics::Direct3D::D3D_PRIMITIVE_TOPOLOGY_TRIANGLELIST;
use windows::Win32::Graphics::Direct3D::D3D_SRV_DIMENSION_TEXTURE2D;
use windows::Win32::Graphics::Direct3D::Fxc::D3DCompile;
use windows::Win32::Graphics::Direct3D11::{
    D3D11_BIND_CONSTANT_BUFFER, D3D11_BIND_DEPTH_STENCIL, D3D11_BIND_RENDER_TARGET,
    D3D11_BIND_SHADER_RESOURCE, D3D11_BUFFER_DESC, D3D11_CLEAR_DEPTH, D3D11_CLEAR_STENCIL,
    D3D11_COMPARISON_NEVER, D3D11_CPU_ACCESS_READ, D3D11_CPU_ACCESS_WRITE, D3D11_CULL_NONE,
    D3D11_DEPTH_STENCIL_DESC, D3D11_FILL_SOLID, D3D11_MAP_READ, D3D11_MAP_WRITE_DISCARD,
    D3D11_MAPPED_SUBRESOURCE, D3D11_RASTERIZER_DESC, D3D11_SAMPLER_DESC,
    D3D11_SHADER_RESOURCE_VIEW_DESC, D3D11_SHADER_RESOURCE_VIEW_DESC_0, D3D11_TEX2D_SRV,
    D3D11_TEXTURE2D_DESC, D3D11_USAGE_DEFAULT, D3D11_USAGE_DYNAMIC, D3D11_USAGE_STAGING,
    D3D11_VIEWPORT, ID3D11Buffer, ID3D11DepthStencilState, ID3D11DepthStencilView, ID3D11Device,
    ID3D11DeviceContext, ID3D11PixelShader, ID3D11RasterizerState, ID3D11RenderTargetView,
    ID3D11SamplerState, ID3D11ShaderResourceView, ID3D11Texture2D, ID3D11VertexShader,
};
use windows::Win32::Graphics::Dxgi::Common::{
    DXGI_FORMAT_B8G8R8A8_UNORM, DXGI_FORMAT_D24_UNORM_S8_UINT, DXGI_SAMPLE_DESC,
};
use windows::Win32::Graphics::Dxgi::IDXGISurface;
use windows::Win32::System::WinRT::Direct3D11::CreateDirect3D11SurfaceFromDXGISurface;

const HLSL: &str = include_str!("../shaders/crop_scale.hlsl");
const PIXEL_FORMAT: windows::Win32::Graphics::Dxgi::Common::DXGI_FORMAT = DXGI_FORMAT_B8G8R8A8_UNORM;

#[repr(C)]
#[derive(Clone, Copy)]
struct UvParams {
    uv_transform: [f32; 4],
}

pub struct GpuScaler {
    out_w: u32,
    out_h: u32,
    out_tex: ID3D11Texture2D,
    out_rtv: ID3D11RenderTargetView,
    staging: [ID3D11Texture2D; 2],
    readback_pending: bool,
    readback_slot: usize,
    out_surface: SendDirectX<IDirect3DSurface>,
    vs: ID3D11VertexShader,
    ps: ID3D11PixelShader,
    sampler: ID3D11SamplerState,
    raster: ID3D11RasterizerState,
    cbuffer: ID3D11Buffer,
    dsv: ID3D11DepthStencilView,
    depth_state: ID3D11DepthStencilState,
    /// WGC pool textures are often not SRV-bindable — blit into this first.
    src_copy: ID3D11Texture2D,
    src_srv: ID3D11ShaderResourceView,
    src_w: u32,
    src_h: u32,
}

impl GpuScaler {
    pub fn new(device: &ID3D11Device, out_w: u32, out_h: u32) -> Result<Self, String> {
        unsafe {
            let vs_blob = compile_blob(HLSL, "vs_main", "vs_5_0")?;
            let ps_blob = compile_blob(HLSL, "ps_main", "ps_5_0")?;

            let mut vs = None;
            device
                .CreateVertexShader(&vs_blob, None, Some(&mut vs))
                .map_err(|e| format!("CreateVertexShader: {e}"))?;
            let vs = vs.unwrap();

            let mut ps = None;
            device
                .CreatePixelShader(&ps_blob, None, Some(&mut ps))
                .map_err(|e| format!("CreatePixelShader: {e}"))?;
            let ps = ps.unwrap();

            let texture_desc = D3D11_TEXTURE2D_DESC {
                Width: out_w,
                Height: out_h,
                MipLevels: 1,
                ArraySize: 1,
                Format: PIXEL_FORMAT,
                SampleDesc: DXGI_SAMPLE_DESC { Count: 1, Quality: 0 },
                Usage: D3D11_USAGE_DEFAULT,
                BindFlags: (D3D11_BIND_RENDER_TARGET.0 | D3D11_BIND_SHADER_RESOURCE.0) as u32,
                CPUAccessFlags: 0,
                MiscFlags: 0,
            };
            let mut out_tex = None;
            device
                .CreateTexture2D(&texture_desc, None, Some(&mut out_tex))
                .map_err(|e| format!("CreateTexture2D: {e}"))?;
            let out_tex = out_tex.unwrap();

            let mut out_rtv = None;
            device
                .CreateRenderTargetView(&out_tex, None, Some(&mut out_rtv))
                .map_err(|e| format!("CreateRTV: {e}"))?;
            let out_rtv = out_rtv.unwrap();

            let dxgi: IDXGISurface = out_tex.cast().map_err(|e| format!("IDXGISurface: {e}"))?;
            let inspectable =
                CreateDirect3D11SurfaceFromDXGISurface(&dxgi).map_err(|e| format!("D3D11 surface: {e}"))?;
            let out_surface: IDirect3DSurface =
                inspectable.cast().map_err(|e| format!("IDirect3DSurface: {e}"))?;

            let sampler_desc = D3D11_SAMPLER_DESC {
                Filter: windows::Win32::Graphics::Direct3D11::D3D11_FILTER_MIN_MAG_MIP_LINEAR,
                AddressU: windows::Win32::Graphics::Direct3D11::D3D11_TEXTURE_ADDRESS_CLAMP,
                AddressV: windows::Win32::Graphics::Direct3D11::D3D11_TEXTURE_ADDRESS_CLAMP,
                AddressW: windows::Win32::Graphics::Direct3D11::D3D11_TEXTURE_ADDRESS_CLAMP,
                ComparisonFunc: D3D11_COMPARISON_NEVER,
                MinLOD: 0.0,
                MaxLOD: f32::MAX,
                ..Default::default()
            };
            let mut sampler = None;
            device
                .CreateSamplerState(&sampler_desc, Some(&mut sampler))
                .map_err(|e| format!("CreateSampler: {e}"))?;

            let raster_desc = D3D11_RASTERIZER_DESC {
                FillMode: D3D11_FILL_SOLID,
                CullMode: D3D11_CULL_NONE,
                DepthClipEnable: true.into(),
                ..Default::default()
            };
            let mut raster = None;
            device
                .CreateRasterizerState(&raster_desc, Some(&mut raster))
                .map_err(|e| format!("CreateRasterizer: {e}"))?;

            let cb_desc = D3D11_BUFFER_DESC {
                ByteWidth: std::mem::size_of::<UvParams>() as u32,
                Usage: D3D11_USAGE_DYNAMIC,
                BindFlags: D3D11_BIND_CONSTANT_BUFFER.0 as u32,
                CPUAccessFlags: D3D11_CPU_ACCESS_WRITE.0 as u32,
                MiscFlags: 0,
                StructureByteStride: 0,
            };
            let mut cbuffer = None;
            device
                .CreateBuffer(&cb_desc, None, Some(&mut cbuffer))
                .map_err(|e| format!("CreateBuffer: {e}"))?;

            let depth_desc = D3D11_TEXTURE2D_DESC {
                Width: out_w,
                Height: out_h,
                MipLevels: 1,
                ArraySize: 1,
                Format: DXGI_FORMAT_D24_UNORM_S8_UINT,
                SampleDesc: DXGI_SAMPLE_DESC { Count: 1, Quality: 0 },
                Usage: D3D11_USAGE_DEFAULT,
                BindFlags: D3D11_BIND_DEPTH_STENCIL.0 as u32,
                CPUAccessFlags: 0,
                MiscFlags: 0,
            };
            let mut depth = None;
            device
                .CreateTexture2D(&depth_desc, None, Some(&mut depth))
                .map_err(|e| format!("depth tex: {e}"))?;
            let depth = depth.unwrap();

            let mut dsv = None;
            device
                .CreateDepthStencilView(&depth, None, Some(&mut dsv))
                .map_err(|e| format!("dsv: {e}"))?;

            let mut depth_state = None;
            device
                .CreateDepthStencilState(&D3D11_DEPTH_STENCIL_DESC::default(), Some(&mut depth_state))
                .map_err(|e| format!("depth state: {e}"))?;

            let staging_desc = D3D11_TEXTURE2D_DESC {
                Width: out_w,
                Height: out_h,
                MipLevels: 1,
                ArraySize: 1,
                Format: PIXEL_FORMAT,
                SampleDesc: DXGI_SAMPLE_DESC { Count: 1, Quality: 0 },
                Usage: D3D11_USAGE_STAGING,
                BindFlags: 0,
                CPUAccessFlags: D3D11_CPU_ACCESS_READ.0 as u32,
                MiscFlags: 0,
            };
            let mut staging0 = None;
            device
                .CreateTexture2D(&staging_desc, None, Some(&mut staging0))
                .map_err(|e| format!("staging tex 0: {e}"))?;
            let mut staging1 = None;
            device
                .CreateTexture2D(&staging_desc, None, Some(&mut staging1))
                .map_err(|e| format!("staging tex 1: {e}"))?;

            let (src_copy, src_srv) = create_src_copy(device, 1, 1)?;

            Ok(Self {
                out_w,
                out_h,
                out_tex: out_tex.clone(),
                out_rtv,
                staging: [staging0.unwrap(), staging1.unwrap()],
                readback_pending: false,
                readback_slot: 0,
                out_surface: SendDirectX::new(out_surface),
                vs,
                ps,
                sampler: sampler.unwrap(),
                raster: raster.unwrap(),
                cbuffer: cbuffer.unwrap(),
                dsv: dsv.unwrap(),
                depth_state: depth_state.unwrap(),
                src_copy,
                src_srv,
                src_w: 1,
                src_h: 1,
            })
        }
    }

    fn ensure_src_copy(
        &mut self,
        device: &ID3D11Device,
        width: u32,
        height: u32,
    ) -> Result<(), String> {
        if width == self.src_w && height == self.src_h {
            return Ok(());
        }
        let (tex, srv) = unsafe { create_src_copy(device, width.max(1), height.max(1))? };
        self.src_copy = tex;
        self.src_srv = srv;
        self.src_w = width.max(1);
        self.src_h = height.max(1);
        Ok(())
    }

    /// Copy the latest monitor texture from WGC into our SRV-bindable cache.
    pub fn ingest_monitor_frame(
        &mut self,
        ctx: &ID3D11DeviceContext,
        device: &ID3D11Device,
        src_tex: &ID3D11Texture2D,
        src_w: u32,
        src_h: u32,
    ) -> Result<(), String> {
        unsafe {
            self.ensure_src_copy(device, src_w, src_h)?;
            ctx.CopyResource(&self.src_copy, src_tex);
        }
        Ok(())
    }

    pub fn render(
        &mut self,
        ctx: &ID3D11DeviceContext,
        device: &ID3D11Device,
        src_tex: &ID3D11Texture2D,
        src_w: u32,
        src_h: u32,
        layout: &FrameLayout,
    ) -> Result<IDirect3DSurface, String> {
        unsafe {
            self.ensure_src_copy(device, src_w, src_h)?;
            ctx.CopyResource(&self.src_copy, src_tex);
        }
        self.draw_crop(ctx, src_w, src_h, layout)
    }

    /// Re-crop the last copied monitor frame (used between WGC updates while the viewport glides).
    pub fn render_cached(
        &mut self,
        ctx: &ID3D11DeviceContext,
        src_w: u32,
        src_h: u32,
        layout: &FrameLayout,
    ) -> Result<IDirect3DSurface, String> {
        if self.src_w <= 1 || self.src_h <= 1 {
            return Err("no cached monitor frame".into());
        }
        self.draw_crop(ctx, src_w, src_h, layout)
    }

    fn draw_crop(
        &mut self,
        ctx: &ID3D11DeviceContext,
        src_w: u32,
        src_h: u32,
        layout: &FrameLayout,
    ) -> Result<IDirect3DSurface, String> {
        let crop = &layout.crop;
        let dest = &layout.dest;
        let sw = src_w.max(1) as f32;
        let sh = src_h.max(1) as f32;
        let params = UvParams {
            uv_transform: [
                crop.x as f32 / sw,
                crop.y as f32 / sh,
                crop.w as f32 / sw,
                crop.h as f32 / sh,
            ],
        };

        unsafe {
            let mut mapped = D3D11_MAPPED_SUBRESOURCE::default();
            ctx.Map(&self.cbuffer, 0, D3D11_MAP_WRITE_DISCARD, 0, Some(&mut mapped))
                .map_err(|e| format!("Map cbuffer: {e}"))?;
            std::ptr::copy_nonoverlapping(
                &params as *const UvParams as *const u8,
                mapped.pData as *mut u8,
                std::mem::size_of::<UvParams>(),
            );
            ctx.Unmap(&self.cbuffer, 0);

            let vp = D3D11_VIEWPORT {
                TopLeftX: dest.x as f32,
                TopLeftY: dest.y as f32,
                Width: dest.w as f32,
                Height: dest.h as f32,
                MinDepth: 0.0,
                MaxDepth: 1.0,
            };

            ctx.OMSetRenderTargets(Some(&[Some(self.out_rtv.clone())]), Some(&self.dsv));
            ctx.ClearRenderTargetView(&self.out_rtv, &[0.0, 0.0, 0.0, 1.0]);
            ctx.ClearDepthStencilView(
                &self.dsv,
                (D3D11_CLEAR_DEPTH | D3D11_CLEAR_STENCIL).0,
                1.0,
                0,
            );
            ctx.RSSetViewports(Some(&[vp]));
            ctx.RSSetState(&self.raster);
            ctx.OMSetDepthStencilState(&self.depth_state, 0);
            ctx.IASetPrimitiveTopology(D3D_PRIMITIVE_TOPOLOGY_TRIANGLELIST);
            ctx.VSSetShader(Some(&self.vs), None);
            ctx.PSSetShader(Some(&self.ps), None);
            ctx.PSSetShaderResources(0, Some(&[Some(self.src_srv.clone())]));
            ctx.PSSetSamplers(0, Some(&[Some(self.sampler.clone())]));
            ctx.PSSetConstantBuffers(0, Some(&[Some(self.cbuffer.clone())]));
            ctx.Draw(3, 0);

            Ok(self.out_surface.0.clone())
        }
    }

    pub fn dimensions(&self) -> (u32, u32) {
        (self.out_w, self.out_h)
    }

    /// Read the latest scaled frame synchronously (preview / streaming).
    pub fn read_bgra(&self, ctx: &ID3D11DeviceContext) -> Result<Vec<u8>, String> {
        unsafe {
            ctx.CopyResource(&self.staging[0], &self.out_tex);
            self.map_staging(ctx, 0)
        }
    }

    /// Finish the previous pipelined readback, if any (call before drawing the next frame).
    pub fn take_pipelined_readback(&mut self, ctx: &ID3D11DeviceContext) -> Option<Vec<u8>> {
        if !self.readback_pending {
            return None;
        }
        let slot = self.readback_slot;
        self.readback_pending = false;
        self.map_staging(ctx, slot).ok()
    }

    /// Queue a GPU copy of the current output for a later `take_pipelined_readback`.
    pub fn queue_readback(&mut self, ctx: &ID3D11DeviceContext) {
        let slot = if self.readback_pending {
            1 - self.readback_slot
        } else {
            0
        };
        unsafe {
            ctx.CopyResource(&self.staging[slot], &self.out_tex);
        }
        self.readback_slot = slot;
        self.readback_pending = true;
    }

    /// Drain any queued readback at recording stop.
    pub fn flush_pipelined_readback(&mut self, ctx: &ID3D11DeviceContext) -> Option<Vec<u8>> {
        self.take_pipelined_readback(ctx)
    }

    pub fn reset_readback_pipeline(&mut self) {
        self.readback_pending = false;
        self.readback_slot = 0;
    }

    fn map_staging(
        &self,
        ctx: &ID3D11DeviceContext,
        slot: usize,
    ) -> Result<Vec<u8>, String> {
        unsafe {
            ctx.Flush();
            let mut mapped = D3D11_MAPPED_SUBRESOURCE::default();
            ctx.Map(&self.staging[slot], 0, D3D11_MAP_READ, 0, Some(&mut mapped))
                .map_err(|e| format!("Map staging: {e}"))?;
            let row_bytes = (self.out_w * 4) as usize;
            let mut out = vec![0u8; row_bytes * self.out_h as usize];
            let src = mapped.pData as *const u8;
            for y in 0..self.out_h as usize {
                std::ptr::copy_nonoverlapping(
                    src.add(y * mapped.RowPitch as usize),
                    out.as_mut_ptr().add(y * row_bytes),
                    row_bytes,
                );
            }
            ctx.Unmap(&self.staging[slot], 0);
            Ok(out)
        }
    }
}

unsafe fn create_src_copy(
    device: &ID3D11Device,
    width: u32,
    height: u32,
) -> Result<(ID3D11Texture2D, ID3D11ShaderResourceView), String> {
    let desc = D3D11_TEXTURE2D_DESC {
        Width: width,
        Height: height,
        MipLevels: 1,
        ArraySize: 1,
        Format: PIXEL_FORMAT,
        SampleDesc: DXGI_SAMPLE_DESC { Count: 1, Quality: 0 },
        Usage: D3D11_USAGE_DEFAULT,
        BindFlags: (D3D11_BIND_SHADER_RESOURCE.0 | D3D11_BIND_RENDER_TARGET.0) as u32,
        CPUAccessFlags: 0,
        MiscFlags: 0,
    };
    let mut tex = None;
    device
        .CreateTexture2D(&desc, None, Some(&mut tex))
        .map_err(|e| format!("src copy tex: {e}"))?;
    let tex = tex.unwrap();

    let srv_desc = D3D11_SHADER_RESOURCE_VIEW_DESC {
        Format: PIXEL_FORMAT,
        ViewDimension: D3D_SRV_DIMENSION_TEXTURE2D,
        Anonymous: D3D11_SHADER_RESOURCE_VIEW_DESC_0 {
            Texture2D: D3D11_TEX2D_SRV {
                MostDetailedMip: 0,
                MipLevels: 1,
            },
        },
    };
    let mut srv = None;
    device
        .CreateShaderResourceView(&tex, Some(&srv_desc), Some(&mut srv))
        .map_err(|e| format!("src copy SRV: {e}"))?;

    Ok((tex, srv.unwrap()))
}

unsafe fn compile_blob(source: &str, entry: &str, profile: &str) -> Result<Vec<u8>, String> {
    let mut blob = None;
    let mut err = None;
    D3DCompile(
        source.as_ptr() as *const _,
        source.len(),
        windows::core::PCSTR::null(),
        None,
        None,
        windows::core::PCSTR(format!("{entry}\0").as_ptr()),
        windows::core::PCSTR(format!("{profile}\0").as_ptr()),
        0,
        0,
        &mut blob,
        Some(&mut err),
    )
    .map_err(|_| {
        if let Some(err_blob) = err {
            String::from_utf8_lossy(std::slice::from_raw_parts(
                err_blob.GetBufferPointer() as *const u8,
                err_blob.GetBufferSize(),
            ))
            .into_owned()
        } else {
            "D3DCompile failed".into()
        }
    })?;
    let blob = blob.ok_or_else(|| "D3DCompile returned null blob".to_string())?;
    let ptr = blob.GetBufferPointer() as *const u8;
    let len = blob.GetBufferSize();
    Ok(std::slice::from_raw_parts(ptr, len).to_vec())
}
