/* 内置候选词典（2026-09 策略调整）
 *
 * 规则一：glm 主线版本号 ≤ 5.2 的候选全部剔除——旧模型已无嗅探价值。
 * 规则二：新增 Preview 内测代号组：glm-x-preview-{a..z}（x 为字面代号），
 *         按字母序 a→z 依次探测，捕捉发布前的内测别名。
 *
 * 注意：版本号过滤只针对 glm 主线（glm-x.y）；
 * 专用线（cogview / cogvideox / embedding / autoglm 等）编号独立，不受 5.2 规则约束。
 */

// 官方模型概览页确认的已开放模型（调用名小写）——仅作“已开放对照”，不参与默认嗅探
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

// Preview 内测代号：glm-x-preview-{a..z}（x 为字面代号，非版本号占位），按字母序 a→z 依次探测
const PREVIEW_LETTERS = 'abcdefghijklmnopqrstuvwxyz'.split('');
const PREVIEW_NAMES = PREVIEW_LETTERS.map((l) => `glm-x-preview-${l}`);

// 悬念候选（全部 > glm-5.2；专用线除外）
const CANDIDATE_GROUPS = {
  'Preview 内测代号（glm-x-preview-a→z）': PREVIEW_NAMES,
  '版本号外推（下一代）': [
    'glm-5.4', 'glm-5.5', 'glm-6',
    'glm-5.4-flash', 'glm-5.5-flash', 'glm-6-flash', 'glm-6-turbo',
  ],
  '5.3 变体外推（当前顶点的后缀家族）': [
    'glm-5.3-plus', 'glm-5.3-air', 'glm-5.3-airx', 'glm-5.3-pro', 'glm-5.3-turbo',
  ],
  '多模态外推（> 5.2 的镜像线）': [
    'glm-5.3v', 'glm-5.3v-flash', 'glm-5.3v-plus',
    'glm-5.4v', 'glm-5.4v-flash', 'glm-5.5v', 'glm-6v',
    'autoglm-2', 'autoglm-pc', 'autoglm-browser',
    'glm-ocr-2', 'glm-ocr-pro', 'glm-ocr-flash',
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

// 生成器可选后缀
const GEN_SUFFIX_OPTIONS = [
  '', '-flash', '-flashx', '-air', '-airx', '-plus', '-pro', '-turbo', '-v', '-v-flash', '-thinking',
];

// 已知免费模型（验证 Key 时优先用它，零成本；不参与嗅探候选）
const FREE_MODEL = 'glm-4.5-flash';
