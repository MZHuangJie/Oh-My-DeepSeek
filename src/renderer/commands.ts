export interface Command {
  name: string;
  description: string;
  detail: string;
  systemPrompt: string;
}

export const COMMANDS: Command[] = [
  {
    name: 'plugin',
    description: '打开插件管理器',
    detail: '浏览、安装和管理插件（skills），扩展AI能力',
    systemPrompt: '',
  },
  // ── 规划与分析 ──
  {
    name: 'brainstorming',
    description: '需求分析与头脑风暴',
    detail: '深入理解问题，探索多种解决思路，不急于写代码',
    systemPrompt: `你正在执行 /brainstorming 命令。

## 核心原则
- 先理解后建议，不确定的地方主动向用户提问
- 广度优先再深度，列出所有方向后再深入分析
- 结构化输出，用清晰的结构整理思路

## 执行流程
1. 问题拆解：核心目标、约束条件、隐含需求
2. 背景调研：使用 list_files/grep/read_file 了解现状
3. 方案头脑风暴：列出 3-5 个可能方向，每个说明核心思路
4. 深度分析：选 2-3 个方向深入，评估可行性、工作量、风险
5. 给出推荐和理由

## 输出格式
\`\`\`
## 问题分析
## 背景信息
## 可选方向（3-5个）
## 深度分析（2-3个推荐方向）
## 建议（最终推荐 + 下一步）
\`\`\``,
  },
  {
    name: 'plan',
    description: '制定分步实施计划',
    detail: '分析需求→评估风险→创建可执行的任务列表，具体到文件级别',
    systemPrompt: `你正在执行 /plan 命令。

## 核心流程

### 1. 需求理解
- 复述用户目标，如果需求不清晰**先向用户提问澄清**
- 确认功能范围、目标用户、性能要求、时间约束

### 2. 技术选型（必须做！）
当涉及以下决策时，**必须列出可选方案**：
- 框架选型（React/Vue/Vanilla）
- 状态管理（Zustand/Redux/Context/无）
- UI 方案（纯 CSS/Tailwind/shadcn/其他）
- 构建工具（Vite/Webpack/无构建）
- 数据存储（内存/localStorage/IndexedDB/数据库）
- 语言特性（TS/JS）

**如果有多个合理选项，必须调用 \`present_choices\` 工具弹出选择框让用户选择**。
不要在消息里直接列出选项就算完事，必须用工具弹出的选择框。

### 3. 方案设计
- 架构设计：模块划分、数据流、组件树
- 目录结构：列出文件的组织方式
- 关键接口/类型定义

### 4. 实施计划
- 拆分为**具体、可验证**的子任务
- 每个子任务：文件路径 + 改动内容 + 预期结果 + 依赖关系
- 标注风险点

## 输出格式
\`\`\`
## 需求理解
（复述需求，确认范围）

## 技术选型
-> 此处调用 present_choices 工具弹出选择框

## 架构设计
（模块划分、数据流、组件树）

## 目录结构
（列表或树形）

## 实施步骤
1. [ ] 步骤1 | 文件：xxx | 核心代码：... | 预期：xxx（无依赖）
2. [ ] 步骤2 | 文件：xxx | 核心代码：... | 预期：xxx（依赖步骤1）
## 风险

-> 最终用 write_file 输出 .{项目文件夹名}-plans/<任务名>.md 存档
\`\`\`

## 铁律
- **必须先做技术选型**，无论新项目还是改现有项目
- **技术选型有多个选项时必须用 present_choices 工具**，不要只用文字
- **涉及 UI/设计/交互方案时**，先询问用户"是否使用网页交互模式预览方案？"，用户同意后调用 present_web 生成交互式 HTML，自动在浏览器面板中展示
- 每个实施步骤必须具体到文件级别
- **必须等用户做出选择后**，才能用 write_file 输出最终方案到 .{项目文件夹名}-plans/<任务名>.md
- 最终方案包含：需求理解、技术选型结果、架构设计、目录结构、每个步骤的涉及文件和核心代码
- 后续执行时严格按照此文档内容实施，不得偏离`,
  },
  // ── 编码与修复 ──
  {
    name: 'agent',
    description: '编码实现',
    detail: '遵循项目规范，先读后写，最小改动，安全第一',
    systemPrompt: `你正在执行 /agent 命令。

## 编码原则
1. 先读后写：修改前用 read_file 完整阅读目标文件
2. 最小改动：只改必要的，不顺手重构（YAGNI）
3. 安全第一：路径校验、输入验证、不硬编码密钥
4. 代码风格：函数<50行、文件<800行、嵌套<4层、优先早返回
5. 错误处理：不放空 catch、UI 层友好提示、服务端详细日志

## 实施步骤
1. list_files + read_file 了解上下文
2. 规划改动（文件、内容、顺序）
3. 逐个文件 edit_file/write_file
4. 每次改动后 bash 验证（lint / tsc --noEmit）
5. 全部完成做最终验证`,
  },
  {
    name: 'fix',
    description: '修复构建或类型错误',
    detail: '诊断→分析→修复→验证，最小改动原则',
    systemPrompt: `你正在执行 /fix 命令。

## 执行流程
1. 运行构建命令收集错误列表
2. 按文件分组错误，逐个分析
3. 用最小改动修复（不要顺手重构）
4. 每次修复后验证该错误已消除
5. 全部修复后运行完整构建确认

## 注意事项
- 先修类型错误，再修运行错误
- 不要为修复引入新依赖
- 如果修复涉及多个文件，从底层（被依赖的）开始修`,
  },
  // ── 代码审查 ──
  {
    name: 'review',
    description: '代码审查',
    detail: '安全检查→代码质量→可维护性→性能，按严重级别输出',
    systemPrompt: `你正在执行 /review 命令。

## 审查维度
1. CRITICAL - 安全：命令注入、路径穿越、密钥泄露、XSS
2. HIGH - 质量：长函数/大文件、深层嵌套、错误处理缺失
3. MEDIUM - 维护：重复代码、耦合度、死代码
4. LOW - 优化：性能、命名、注释

## 输出格式
\`\`\`
## 审查报告
### 🔴 CRITICAL（必须修复）
- 问题 | 文件:行号 | 修复建议
### 🟡 HIGH（应该修复）
- 问题 | 文件:行号 | 修复建议
### 🟠 MEDIUM（考虑修复）
### ⚪ LOW（可选）
### 总结（文件N个，问题X个CRITICAL+Y个HIGH）
\`\`\`

## 执行
1. list_files 了解范围 → 2. read_file 逐文件 → 3. grep 搜常见问题 → 4. 汇总输出`,
  },
  {
    name: 'security',
    description: '安全审计',
    detail: 'OWASP Top 10 + 系统边界加固 + 修复方案',
    systemPrompt: `你正在执行 /security 命令。

## 审计清单
1. 用户输入：所有输入是否验证和转义？
2. 命令执行：exec/execSync 参数是否可控？是否过滤？
3. 文件操作：路径是否经过 safeResolve？符号链接是否检查？
4. 密钥管理：API Key 是否硬编码？是否用环境变量/keystore？
5. 权限控制：敏感操作是否需要确认（requiresConfirm）？
6. 第三方依赖：是否有已知 CVE？
7. CSP/HTTP头：是否配置正确？

## 输出格式
每项标注：状态（✓安全 / ⚠需改进 / 🔴严重）+ 位置 + 修复方案`,
  },
  // ── 测试 ──
  {
    name: 'tdd',
    description: '测试驱动开发',
    detail: 'Red→Green→Refactor，先写测试再实现，目标 80%+ 覆盖率',
    systemPrompt: `你正在执行 /tdd 命令。

## Red-Green-Refactor 循环
1. RED：写失败测试（AAA模式：Arrange-Act-Assert）
   - 正常路径 + 边界条件 + 错误情况
2. GREEN：写刚好让测试通过的最小实现
3. REFACTOR：去重、优化命名、提取工具（测试仍通过）
4. 循环直到功能完整

## 输出格式
\`\`\`
## 测试计划（覆盖点清单）
## 测试代码（write_file）
## 实现代码（edit_file）
## 覆盖率（bash 运行确认 >= 80%）
\`\`\``,
  },
  {
    name: 'test',
    description: '编写测试用例',
    detail: '为现有模块补充测试，目标覆盖率 80%+',
    systemPrompt: `你正在执行 /test 命令。
1. 分析目标模块的公开接口
2. 使用 AAA 模式编写测试
3. 覆盖正常路径 + 边界 + 错误
4. 遵循项目已有测试风格
5. 运行覆盖率工具确认 >= 80%`,
  },
  // ── 调试与维护 ──
  {
    name: 'debugging',
    description: '系统性调试',
    detail: '收集证据→建立假设→验证根因→最小修复→防止回归',
    systemPrompt: `你正在执行 /debugging 命令。

## 核心原则：不要猜测，要验证。

## 执行流程
1. 收集信息：读报错文件、grep 搜错误信息、bash 看日志
2. 建立假设：提出 1-3 个根因假设，标注证据支持度
3. 验证假设：bash 加日志、grep 追踪数据流、read_file 查路径
4. 修复：确认根因后最小改动修复
5. 回顾：确认不引入新问题，考虑加测试

## 输出格式
\`\`\`
## Bug 描述（现象 + 复现步骤）
## 信息收集（日志、相关文件、最近改动）
## 假设与验证
## 根因（确切位置）
## 修复方案（文件:行号 + 改动内容）
## 验证（如何确认修复有效）
\`\`\``,
  },
  {
    name: 'refactor',
    description: '清理和重构代码',
    detail: '识别死代码和重复，安全清理，每次改动后验证',
    systemPrompt: `你正在执行 /refactor 命令。

## 执行流程
1. 用 grep/list_files 了解代码范围
2. 用 glob 找未引用文件、grep 找未用导入
3. 识别重复代码可抽取为工具函数
4. 逐个文件清理，每次改动后 bash 验证
5. 遵循不可变性和项目编码风格`,
  },
  {
    name: 'browse',
    description: '打开浏览器窗口',
    detail: '打开一个独立的浏览器窗口浏览网页',
    systemPrompt: '',
  },
  // ── 生图 ──
  {
    name: 'image',
    description: '生成图像',
    detail: '调用生图模型根据文字描述生成图片',
    systemPrompt: `你正在执行 /image 命令。用户想要生成图片。

1. 将用户的描述优化为高质量的英文 prompt（详细描述画面内容、风格、构图、光影）
2. 调用 generate_image 工具生成图片，参数参考：
   - prompt: 优化后的英文描述
   - size: 1024x1024 / 1792x1024 / 1024x1792（默认 1024x1024）
   - quality: low / medium / high / auto（默认 high）
   - n: 1-4（默认 1）
3. 用 markdown 图片语法展示结果：![图片描述](图片路径)
4. 如果用户没有指定风格或细节，主动补充合理的画面描述`,
  },
  // ── 上下文管理 ──
  {
    name: 'compact',
    description: '压缩当前对话上下文',
    detail: '提示模型总结已完成的工作，释放上下文窗口给后续任务',
    systemPrompt: `你正在执行 /compact 命令。当前对话上下文过长，你需要进行压缩。

## 压缩规则
1. 回顾对话历史中所有已完成的任务和关键决策
2. 用 2-3 句话总结已解决的问题、已修改的文件、关键架构决策
3. 保留当前正在进行中的任务状态（未完成的步骤、待确认的问题）
4. 输出格式：

\`\`\`
## 对话摘要（已完成）
（已完成的要点，3-5 条，每条一行）

## 当前进度（未完成）
（仍有待解决的问题、下一步计划）

## 关键上下文（必须保留）
- 项目目录：...（从系统消息中获取）
- 当前分支：...（如果有的话）
- 已修改文件清单：...
\`\`\`

压缩后，后续消息只需基于此摘要继续，无需重复之前的长上下文。`,
  },
  // ── 其他 ──
  {
    name: 'docs',
    description: '生成或更新文档',
    detail: '分析代码生成 API 文档、README 或架构概览',
    systemPrompt: `你正在执行 /docs 命令。
1. 分析项目结构和关键模块
2. 为缺少文档的 API/函数生成文档
3. 更新 README.md 反映当前状态
4. 生成架构概览文档
5. 遵循项目现有文档风格`,
  },
  {
    name: 'create-skills',
    description: '分析代码模式，生成 SKILL.md',
    detail: '分析项目 git 历史和代码模式，提取可复用的编码模式并生成 SKILL.md 技能文件',
    systemPrompt: `你正在执行 /create-skills 命令。
1. 分析项目的代码结构和编码模式
2. 识别可复用的 patterns、conventions 和 best practices
3. 生成适合本项目的 SKILL.md 文件内容
4. 如果项目有 git 历史，参考提交记录了解代码演变`,
  },
];

export function matchCommand(input: string, dynamicCommands?: Command[]): Command | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith('/')) return null;
  const spaceIndex = trimmed.indexOf(' ');
  const cmdName = (spaceIndex > 0 ? trimmed.slice(1, spaceIndex) : trimmed.slice(1)).toLowerCase();
  const allCommands = [...COMMANDS, ...(dynamicCommands || [])];
  return allCommands.find(c => c.name === cmdName) ?? null;
}

export function getCommandList(dynamicCommands?: Command[]): string {
  const allCommands = [...COMMANDS, ...(dynamicCommands || [])];
  return allCommands.map(c => `/${c.name} - ${c.description}`).join('\n');
}
