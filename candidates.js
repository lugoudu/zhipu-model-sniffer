/* 内置候选词典：基于智谱官方已开放模型（2026-08 实测全景）+ 命名规律外推。
 * “已开放对照”用于跳过与对照；“悬念候选”是嗅探的主要目标。 */

// 官方模型概览页确认的已开放模型（调用名小写）
const OPEN_MODELS_SEED = {
  '旗舰与主力文本': [
    'glm-5.3', 'glm-5.2', 'glm-5.1', 'glm-5', 'glm-5-turbo',
    'glm-4.7', 'glm-4.6', 'glm-4-long',
  ],
  '轻量与免费文本': [
    'glm-4.7-flash', 'glm-4.7-flashx', 'glm-4.5-flash', 'glm-4.5-air', 'glm-4.5-airx', 'glm-4-flash-250414',
  ],
  '视觉理解': [
    'glm-5.3-flash', 'glm-5v-turbo', 'glm-4.6v', 'glm-4.6v-flash',
    'glm-4.1v-thinking-flash', 'glm-4.1v-thinking-flashx', 'glm-4v-flash', 'autoglm-phone', 'glm-ocr',
  ],
  '图像 / 视频 / 音频': [
    'glm-image', 'cogview-4', 'cogview-3-flash',
    'cogvideox-3', 'cogvideox-flash', 'vidu-q1', 'vidu-2',
    'glm-asr-2512', 'glm-tts', 'glm-tts-clone', 'glm-realtime', 'glm-4-voice',
  ],
  '向量 / 其他': [
    'embedding-2', 'embedding-3', 'rerank', 'charglm-4', 'emohaa', 'codegeex-4',
  ],
};

// 悬念候选：按命名规律外推的“可能存在但未开放”的模型名
const CANDIDATE_GROUPS = {
  '版本号外推（下一代）': [
    'glm-5.4', 'glm-5.5', 'glm-6', 'glm-4.8', 'glm-4.9',
    'glm-5.4-flash', 'glm-5.5-flash', 'glm-6-flash', 'glm-6-turbo',
  ],
  '旗舰变体外推（air / plus / pro / turbo）': [
    'glm-5.3-plus', 'glm-5.3-air', 'glm-5.3-airx', 'glm-5.3-pro', 'glm-5.3-turbo',
    'glm-5.2-air', 'glm-5.2-airx', 'glm-5.2-plus', 'glm-5.2-pro',
    'glm-5-plus', 'glm-5-air', 'glm-5-airx', 'glm-5-pro',
    'glm-4.7-plus', 'glm-4.7-air', 'glm-4.7-airx', 'glm-4.7-pro',
    'glm-4.6-plus', 'glm-4.6-air', 'glm-4.6-pro', 'glm-4.6-flashx',
  ],
  '多模态外推（V / OCR / AutoGLM）': [
    'glm-5v', 'glm-5v-plus', 'glm-5v-flash',
    'glm-5.2v', 'glm-5.3v', 'glm-5.3v-flash',
    'glm-4.7v', 'glm-4.7v-flash', 'glm-4.6v-plus',
    'glm-4.1v-thinking', 'glm-4.1v-thinking-pro',
    'glm-ocr-2', 'glm-ocr-pro', 'glm-ocr-flash',
    'autoglm-2', 'autoglm-pc', 'autoglm-browser',
  ],
  '语音 / 视频生成外推': [
    'glm-asr', 'glm-asr-2', 'glm-asr-pro',
    'glm-tts-2', 'glm-tts-pro', 'glm-realtime-2',
    'cogvideox-4', 'cogvideox-3-plus', 'cogvideox-3-flash',
    'vidu-3', 'vidu-q2', 'glm-video', 'glm-video-2',
  ],
  '图像生成外推': [
    'cogview-5', 'cogview-4-plus', 'cogview-4-flash', 'glm-image-2',
  ],
  '向量 / 代码 / 智能体外推': [
    'embedding-4', 'rerank-2', 'rerank-pro',
    'codegeex-5', 'codegeex-next', 'charglm-5', 'emohaa-2',
    'glm-agent', 'glm-zero', 'glm-zero-proto',
  ],
};

// 生成器可选后缀（布尔选中态由前端管理，这里只提供选项）
const GEN_SUFFIX_OPTIONS = [
  '', '-flash', '-flashx', '-air', '-airx', '-plus', '-pro', '-turbo', '-v', '-v-flash', '-thinking',
];

// 已知免费模型（验证 Key 时优先用它，零成本）
const FREE_MODEL = 'glm-4.5-flash';
