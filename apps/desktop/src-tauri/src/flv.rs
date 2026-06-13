//! FLV tag builders for H.264 (AVC) and AAC used by RTMP publishers.

use bytes::{BufMut, Bytes, BytesMut};

/// FLV video codec id for AVC / H.264.
pub const FLV_VIDEO_CODEC_AVC: u8 = 7;
/// FLV audio codec id for AAC.
pub const FLV_AUDIO_CODEC_AAC: u8 = 10;

/// Build an FLV AVC sequence header (AVCDecoderConfigurationRecord).
pub fn avc_sequence_header(sps: &[u8], pps: &[u8]) -> Bytes {
    let mut buf = BytesMut::with_capacity(16 + sps.len() + pps.len());
    // FrameType=1 (keyframe), CodecID=7 (AVC)
    buf.put_u8(0x17);
    // AVCPacketType=0 (sequence header)
    buf.put_u8(0x00);
    // CompositionTime = 0
    buf.put_u8(0x00);
    buf.put_u8(0x00);
    buf.put_u8(0x00);
    // AVCDecoderConfigurationRecord
    buf.put_u8(0x01); // configurationVersion
    buf.put_u8(sps.get(1).copied().unwrap_or(0x64)); // AVCProfileIndication
    buf.put_u8(sps.get(2).copied().unwrap_or(0x00)); // profile_compatibility
    buf.put_u8(sps.get(3).copied().unwrap_or(0x1e)); // AVCLevelIndication
    buf.put_u8(0xff); // lengthSizeMinusOne (4 bytes)
    buf.put_u8(0xe1); // numOfSequenceParameterSets = 1
    buf.put_u16(sps.len() as u16);
    buf.put_slice(sps);
    buf.put_u8(0x01); // numOfPictureParameterSets = 1
    buf.put_u16(pps.len() as u16);
    buf.put_slice(pps);
    buf.freeze()
}

/// Build an FLV AVC NALU packet.
pub fn avc_nalu(nal_units: &[u8], timestamp_ms: u32, is_keyframe: bool) -> Bytes {
    let frame_type = if is_keyframe { 0x10 } else { 0x20 };
    let mut buf = BytesMut::with_capacity(9 + nal_units.len());
    buf.put_u8(frame_type | FLV_VIDEO_CODEC_AVC);
    buf.put_u8(0x01); // AVCPacketType = NALU
    let cts = 0i32;
    buf.put_u8(((cts >> 16) & 0xff) as u8);
    buf.put_u8(((cts >> 8) & 0xff) as u8);
    buf.put_u8((cts & 0xff) as u8);
    buf.put_slice(nal_units);
    buf.freeze()
}

/// AAC AudioSpecificConfig for 48 kHz stereo AAC-LC.
pub fn aac_sequence_header() -> Bytes {
    let mut buf = BytesMut::with_capacity(4);
    // SoundFormat=10 (AAC), SoundRate=3 (44k/48k), SoundSize=1 (16-bit), SoundType=1 (stereo)
    buf.put_u8(0xaf);
    buf.put_u8(0x00); // AACPacketType = sequence header
    // AudioSpecificConfig: AAC-LC, 48kHz, 2 channels
    buf.put_u8(0x12);
    buf.put_u8(0x10);
    buf.freeze()
}

/// AAC raw frame packet (ADTS payload without the 7-byte ADTS header).
pub fn aac_raw_frame(adts_frame: &[u8]) -> Bytes {
    let payload = if adts_frame.len() > 7 {
        &adts_frame[7..]
    } else {
        adts_frame
    };
    let mut buf = BytesMut::with_capacity(2 + payload.len());
    buf.put_u8(0xaf); // AAC, 48kHz, 16-bit, stereo
    buf.put_u8(0x01); // AACPacketType = raw
    buf.put_slice(payload);
    buf.freeze()
}

/// Pre-built silent AAC-LC ADTS frame (48 kHz, stereo, 1024 samples).
pub fn silent_aac_adts() -> &'static [u8] {
    &[
        0xff, 0xf1, 0x4c, 0x40, 0x01, 0x3f, 0xfc, 0x01, 0x40, 0x22, 0x80, 0xa3, 0x07,
    ]
}

/// Split Annex-B H.264 buffer into individual NAL units (without start codes).
pub fn split_annex_b(data: &[u8]) -> Vec<Vec<u8>> {
    let mut nals = Vec::new();
    let mut i = 0;
    while i < data.len() {
        let mut start = None;
        if i + 3 < data.len() && data[i] == 0 && data[i + 1] == 0 && data[i + 2] == 1 {
            start = Some(i + 3);
            i += 3;
        } else if i + 4 < data.len()
            && data[i] == 0
            && data[i + 1] == 0
            && data[i + 2] == 0
            && data[i + 3] == 1
        {
            start = Some(i + 4);
            i += 4;
        } else {
            i += 1;
            continue;
        }
        if let Some(nal_start) = start {
            let mut nal_end = data.len();
            let mut j = nal_start;
            while j + 3 < data.len() {
                if data[j] == 0 && data[j + 1] == 0 && (data[j + 2] == 1 || (data[j + 2] == 0 && data[j + 3] == 1)) {
                    nal_end = j;
                    break;
                }
                j += 1;
            }
            if nal_start < nal_end {
                nals.push(data[nal_start..nal_end].to_vec());
            }
            i = nal_end;
        }
    }
    nals
}

/// Convert Annex-B NAL units to AVCC length-prefixed format for FLV.
pub fn annex_b_to_avcc(nals: &[Vec<u8>]) -> Vec<u8> {
    let mut out = Vec::new();
    for nal in nals {
        let len = nal.len() as u32;
        out.extend_from_slice(&len.to_be_bytes());
        out.extend_from_slice(nal);
    }
    out
}

/// Extract SPS/PPS from Annex-B access unit. Returns (sps, pps, slice_nals, is_keyframe).
pub fn parse_access_unit(data: &[u8]) -> Option<(Vec<u8>, Vec<u8>, Vec<Vec<u8>>, bool)> {
    let nals = split_annex_b(data);
    if nals.is_empty() {
        return None;
    }
    let mut sps = None;
    let mut pps = None;
    let mut slices = Vec::new();
    let mut is_keyframe = false;
    for nal in nals {
        let nal_type = nal.first().copied().unwrap_or(0) & 0x1f;
        match nal_type {
            7 => sps = Some(nal),
            8 => pps = Some(nal),
            5 => {
                is_keyframe = true;
                slices.push(nal);
            }
            1 => slices.push(nal),
            _ => {}
        }
    }
    let sps = sps?;
    let pps = pps?;
    if slices.is_empty() {
        return None;
    }
    Some((sps, pps, slices, is_keyframe))
}
