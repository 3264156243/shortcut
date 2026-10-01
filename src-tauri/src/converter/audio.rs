//! 音频转换——symphonia 解码（wav/mp3/flac/ogg-vorbis/m4a-aac/opus）→
//! wav（手写 PCM 容器）/ mp3（LAME）/ flac（flacenc）/ opus（libopus）
//! 全量内存管线（一首歌峰值约 100MB f32；流式为后续优化项）
//! 采样率：wav/mp3/flac 保持源率；opus 仅支持 8/12/16/24/48k → rubato 重采样到 48k

use std::fs::{self, File};
use std::io::Write;
use std::path::Path;

/// 解码结果：交织 f32 采样 + 规格
pub struct DecodedAudio {
    pub samples: Vec<f32>,
    pub channels: usize,
    pub sample_rate: u32,
}

/// symphonia 解码到交织 f32
pub fn decode(path: &Path) -> Result<DecodedAudio, String> {
    use symphonia::core::audio::SampleBuffer;
    use symphonia::core::codecs::{DecoderOptions, CODEC_TYPE_NULL};
    use symphonia::core::errors::Error as SymphoniaError;
    use symphonia::core::formats::FormatOptions;
    use symphonia::core::io::MediaSourceStream;
    use symphonia::core::meta::MetadataOptions;
    use symphonia::core::probe::Hint;

    let file = File::open(path).map_err(|e| format!("打开音频文件失败: {}", e))?;
    let mss = MediaSourceStream::new(Box::new(file), Default::default());
    let mut hint = Hint::new();
    if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
        hint.with_extension(ext);
    }
    let probed = symphonia::default::get_probe()
        .format(&hint, mss, &FormatOptions::default(), &MetadataOptions::default())
        .map_err(|e| format!("音频格式识别失败（格式不支持或文件损坏）: {}", e))?;
    let mut format = probed.format;
    let track = format
        .tracks()
        .iter()
        .find(|t| t.codec_params.codec != CODEC_TYPE_NULL)
        .ok_or("文件中没有音频轨")?;
    let track_id = track.id;
    let mut decoder = symphonia::default::get_codecs()
        .make(&track.codec_params, &DecoderOptions::default())
        .map_err(|e| format!("音频解码器初始化失败: {}", e))?;

    let mut samples: Vec<f32> = Vec::new();
    let mut channels = 0usize;
    let mut sample_rate = 0u32;
    loop {
        let packet = match format.next_packet() {
            Ok(p) => p,
            Err(SymphoniaError::IoError(e))
                if e.kind() == std::io::ErrorKind::UnexpectedEof =>
            {
                break; // 正常流结束
            }
            Err(SymphoniaError::ResetRequired) => {
                return Err("音频流需要重置，暂不支持".into());
            }
            Err(e) => return Err(format!("音频读取失败: {}", e)),
        };
        if packet.track_id() != track_id {
            continue;
        }
        match decoder.decode(&packet) {
            Ok(decoded) => {
                let spec = *decoded.spec();
                channels = spec.channels.count();
                sample_rate = spec.rate;
                let mut buf = SampleBuffer::<f32>::new(decoded.capacity() as u64, spec);
                buf.copy_interleaved_ref(decoded);
                samples.extend_from_slice(buf.samples());
            }
            Err(SymphoniaError::DecodeError(e)) => {
                log::warn!("[converter] 音频解码跳过坏包: {}", e);
                continue;
            }
            Err(e) => return Err(format!("音频解码失败: {}", e)),
        }
    }
    if samples.is_empty() || channels == 0 {
        return Err("没有解码出音频数据".into());
    }
    Ok(DecodedAudio {
        samples,
        channels,
        sample_rate,
    })
}

/// f32 交织 → i16（clamp）
fn f32_to_i16(samples: &[f32]) -> Vec<i16> {
    samples
        .iter()
        .map(|s| (s.clamp(-1.0, 1.0) * 32767.0) as i16)
        .collect()
}

/// 交织 → 按通道拆分（>2 声道取前两路，单声道复制）
fn split_channels(samples: &[f32], channels: usize) -> (Vec<f32>, Vec<f32>, usize) {
    match channels {
        0 => (vec![], vec![], 1),
        1 => (samples.to_vec(), samples.to_vec(), 1),
        _ => {
            let ch = channels.min(2);
            let mut left = Vec::with_capacity(samples.len() / channels);
            let mut right = Vec::with_capacity(samples.len() / channels);
            for frame in samples.chunks(channels) {
                left.push(frame[0]);
                if ch == 2 {
                    right.push(frame[1]);
                }
            }
            (left, right, ch)
        }
    }
}

/// WAV 输出：16-bit PCM 手写容器（保持源采样率）
pub fn encode_wav(audio: &DecodedAudio, out: &Path) -> Result<(), String> {
    let pcm = f32_to_i16(&audio.samples);
    let data_len = pcm.len() * 2;
    let mut file = File::create(out).map_err(|e| format!("创建输出文件失败: {}", e))?;
    let write_all = |f: &mut File, b: &[u8]| f.write_all(b).map_err(|e| format!("WAV 写入失败: {}", e));
    write_all(&mut file, b"RIFF")?;
    write_all(&mut file, &(36 + data_len as u32).to_le_bytes())?;
    write_all(&mut file, b"WAVE")?;
    write_all(&mut file, b"fmt ")?;
    write_all(&mut file, &16u32.to_le_bytes())?;
    write_all(&mut file, &1u16.to_le_bytes())?; // PCM
    write_all(&mut file, &(audio.channels as u16).to_le_bytes())?;
    write_all(&mut file, &audio.sample_rate.to_le_bytes())?;
    let byte_rate = audio.sample_rate * audio.channels as u32 * 2;
    write_all(&mut file, &byte_rate.to_le_bytes())?;
    write_all(&mut file, &(audio.channels as u16 * 2).to_le_bytes())?;
    write_all(&mut file, &16u16.to_le_bytes())?;
    write_all(&mut file, b"data")?;
    write_all(&mut file, &(data_len as u32).to_le_bytes())?;
    for v in &pcm {
        write_all(&mut file, &v.to_le_bytes())?;
    }
    file.sync_all().map_err(|e| format!("WAV 收尾失败: {}", e))?;
    Ok(())
}

/// MP3 输出（mp3lame-encoder 0.2.5）：kbps ∈ {128,192,256,320}，默认 192
pub fn encode_mp3(audio: &DecodedAudio, out: &Path, kbps: u32) -> Result<(), String> {
    use mp3lame_encoder::{Bitrate, Builder, Encoder, FlushNoGap, InterleavedPcm, MonoPcm};
    let mut builder = Builder::new().ok_or("MP3 编码器初始化失败")?;
    builder
        .set_sample_rate(audio.sample_rate)
        .map_err(|e| format!("不支持的采样率 {}: {}", audio.sample_rate, e))?;
    builder
        .set_num_channels(if audio.channels >= 2 { 2 } else { 1 })
        .map_err(|e| format!("声道设置失败: {}", e))?;
    // 注意：库内方法名就叫 set_brate（上游拼写）
    builder
        .set_brate(match kbps {
            128 => Bitrate::Kbps128,
            256 => Bitrate::Kbps256,
            320 => Bitrate::Kbps320,
            _ => Bitrate::Kbps192,
        })
        .map_err(|e| format!("码率设置失败: {}", e))?;
    let mut encoder: Encoder = builder.build().map_err(|e| format!("MP3 编码器构建失败: {}", e))?;
    let mut out_bytes: Vec<u8> = Vec::with_capacity(audio.samples.len() / 4 + 4096);
    if audio.channels >= 2 {
        encoder
            .encode_to_vec(InterleavedPcm(&audio.samples), &mut out_bytes)
            .map_err(|e| format!("MP3 编码失败: {}", e))?;
        encoder
            .flush_to_vec::<FlushNoGap>(&mut out_bytes)
            .map_err(|e| format!("MP3 收尾失败: {}", e))?;
    } else {
        encoder
            .encode_to_vec(MonoPcm(&audio.samples), &mut out_bytes)
            .map_err(|e| format!("MP3 编码失败: {}", e))?;
        encoder
            .flush_to_vec::<FlushNoGap>(&mut out_bytes)
            .map_err(|e| format!("MP3 收尾失败: {}", e))?;
    }
    fs::write(out, out_bytes).map_err(|e| format!("MP3 写入失败: {}", e))?;
    Ok(())
}

/// FLAC 输出（flacenc 0.4.0 原版，16-bit，保持源采样率）
pub fn encode_flac(audio: &DecodedAudio, out: &Path) -> Result<(), String> {
    use flacenc::error::Verify;
    let pcm = f32_to_i16(&audio.samples);
    let as_i32: Vec<i32> = pcm.iter().map(|&v| v as i32).collect();
    let channels = audio.channels.min(2).max(1);
    // >2 声道时截取前两路
    let samples_i32: Vec<i32> = if audio.channels > 2 {
        as_i32
            .chunks(audio.channels)
            .flat_map(|frame| &frame[..2])
            .copied()
            .collect()
    } else {
        as_i32
    };
    let source = flacenc::source::MemSource::from_samples(
        &samples_i32,
        channels,
        16,
        audio.sample_rate as usize,
    );
    let config = flacenc::config::Encoder::default()
        .into_verified()
        .map_err(|(_, e)| format!("FLAC 编码配置无效: {}", e))?;
    let stream = flacenc::encode_with_fixed_block_size(&config, source, 4096)
        .map_err(|e| format!("FLAC 编码失败: {:?}", e))?;
    let mut sink = flacenc::bitsink::ByteSink::new();
    use flacenc::component::BitRepr;
    stream
        .write(&mut sink)
        .map_err(|e| format!("FLAC 比特流写出失败: {}", e))?;
    fs::write(out, sink.into_inner()).map_err(|e| format!("FLAC 写入失败: {}", e))?;
    Ok(())
}

/// OPUS 输出（libopus + ogg crate 正规封装）：统一重采样到 48k；kbps 默认 128
pub fn encode_opus(audio: &DecodedAudio, out: &Path, kbps: u32) -> Result<(), String> {
    use ogg::{PacketWriteEndInfo, PacketWriter};
    use opus::{Application, Bitrate, Channels};
    const OUT_RATE: u32 = 48_000;
    const FRAME: usize = 960; // 20ms @48k

    let (left, right, out_channels) = split_channels(&audio.samples, audio.channels);
    let stereo = audio.channels >= 2;
    let _ = out_channels;
    // 重采样（源率 ≠ 48k 时）
    let (l, r) = if audio.sample_rate != OUT_RATE {
        resample_to_48k(&left, &right, audio.sample_rate, stereo)?
    } else {
        (left, right)
    };
    let mut interleaved: Vec<f32> = Vec::with_capacity(if stereo { l.len() * 2 } else { l.len() });
    if stereo {
        for (a, b) in l.iter().zip(r.iter()) {
            interleaved.push(*a);
            interleaved.push(*b);
        }
    } else {
        interleaved = l;
    }

    let mut enc = opus::Encoder::new(
        OUT_RATE,
        if stereo { Channels::Stereo } else { Channels::Mono },
        Application::Audio,
    )
    .map_err(|e| format!("Opus 编码器初始化失败: {}", e))?;
    enc.set_bitrate(Bitrate::Bits(kbps.max(64) as i32 * 1000))
        .map_err(|e| format!("Opus 码率设置失败: {}", e))?;

    // 逐帧编码，保留每帧独立包（Ogg 按帧封装）
    let frame_bytes = FRAME * if stereo { 2 } else { 1 };
    let mut frames: Vec<Vec<u8>> = Vec::with_capacity(interleaved.len() / frame_bytes + 8);
    let mut chunk = vec![0f32; frame_bytes];
    for block in interleaved.chunks(frame_bytes) {
        chunk[..block.len()].copy_from_slice(block);
        if block.len() < frame_bytes {
            chunk[block.len()..].fill(0.0);
        }
        let mut dst = [0u8; 4000];
        let n = enc
            .encode_float(&chunk, &mut dst)
            .map_err(|e| format!("Opus 编码失败: {}", e))?;
        frames.push(dst[..n].to_vec());
    }

    // Ogg Opus 封装（ogg crate：正确 CRC/分页/granule）
    let mut head: Vec<u8> = vec![b'O', b'p', b'u', b's', b'H', b'e', b'a', b'd'];
    head.extend_from_slice(&1u8.to_le_bytes());
    head.push(if stereo { 2 } else { 1 });
    head.extend_from_slice(&0u16.to_le_bytes()); // pre-skip
    head.extend_from_slice(&OUT_RATE.to_le_bytes()); // original input rate
    head.extend_from_slice(&0i16.to_le_bytes()); // output gain
    head.push(0); // mapping family (mono/stereo)
    let mut tags: Vec<u8> = vec![b'O', b'p', b'u', b's', b'T', b'a', b'g', b's'];
    tags.extend_from_slice(&8u32.to_le_bytes());
    tags.extend_from_slice(b"ShortCut");
    tags.extend_from_slice(&0u32.to_le_bytes());

    let serial: u32 = 0x53_43_4F_50; // "SCOP"
    let file = File::create(out).map_err(|e| format!("创建输出文件失败: {}", e))?;
    let mut writer = PacketWriter::new(file);
    // OpusHead（BOS 自动由首页标记）
    writer
        .write_packet(head, serial, PacketWriteEndInfo::EndPage, 0)
        .map_err(|e| format!("Ogg 头写入失败: {}", e))?;
    // OpusTags
    writer
        .write_packet(tags, serial, PacketWriteEndInfo::EndPage, 0)
        .map_err(|e| format!("Ogg 标签写入失败: {}", e))?;
    // 音频帧：每帧独立包，最后一帧 EndStream
    let total = frames.len();
    for (i, frame) in frames.iter().enumerate() {
        let granule = (i as u64 + 1) * FRAME as u64;
        let inf = if i + 1 == total {
            PacketWriteEndInfo::EndStream
        } else {
            PacketWriteEndInfo::EndPage
        };
        writer
            .write_packet(frame.clone(), serial, inf, granule)
            .map_err(|e| format!("Ogg 音频写入失败: {}", e))?;
    }
    Ok(())
}

/// rubato 重采样到 48k（FftFixedIn，逐块）
fn resample_to_48k(
    left: &[f32],
    right: &[f32],
    in_rate: u32,
    stereo: bool,
) -> Result<(Vec<f32>, Vec<f32>), String> {
    use rubato::{FftFixedIn, Resampler};
    let mut resampler = FftFixedIn::<f32>::new(
        in_rate as usize,
        48_000,
        1024,
        2,
        if stereo { 2 } else { 1 },
    )
    .map_err(|e| format!("重采样器初始化失败: {}", e))?;
    let mut out_l: Vec<f32> = Vec::with_capacity(left.len() * 48_000 / in_rate as usize + 4096);
    let mut out_r: Vec<f32> = if stereo {
        Vec::with_capacity(right.len() * 48_000 / in_rate as usize + 4096)
    } else {
        Vec::new()
    };
    // 按 resampler 块长处理
    let chunk_in = resampler.input_frames_max();
    let mut i = 0usize;
    while i < left.len() {
        let end = (i + chunk_in).min(left.len());
        let len = end - i;
        let mut input = vec![vec![0f32; chunk_in]; if stereo { 2 } else { 1 }];
        input[0][..len].copy_from_slice(&left[i..end]);
        if stereo {
            input[1][..len].copy_from_slice(&right[i..end]);
        }
        let processed = resampler
            .process(&input, None)
            .map_err(|e| format!("重采样失败: {}", e))?;
        out_l.extend_from_slice(&processed[0]);
        if stereo {
            out_r.extend_from_slice(&processed[1]);
        }
        i = end;
    }
    // 非整块补零后可能产生少量额外采样——不影响可听性
    Ok((out_l, out_r))
}

pub fn is_valid_target(target: &str) -> bool {
    ["wav", "mp3", "flac", "opus"].contains(&target.to_ascii_lowercase().as_str())
}

pub fn same_format(src_ext: &str, target: &str) -> bool {
    let a = src_ext.trim_start_matches('.').to_ascii_lowercase();
    let b = target.trim_start_matches('.').to_ascii_lowercase();
    a == b
}

/// 测试用：写一个 16-bit PCM wav
#[cfg(test)]
pub(crate) fn write_test_wav(path: &Path, samples: &[f32], channels: usize, rate: u32) {
    let audio = DecodedAudio {
        samples: samples.to_vec(),
        channels,
        sample_rate: rate,
    };
    encode_wav(&audio, path).unwrap();
}
