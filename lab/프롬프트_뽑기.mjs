// 프롬프트 모음 만들기 (11/5 사용자 "모든 프롬프트 md 모인 폴더 주고 프롬프트별 역할과 설명"): the engine's prompts, taken from
// the code as they are now, one .md each in lab/프롬프트/, with what each does. The code stays the source; run this again after a change:
//   node --experimental-strip-types lab/프롬프트_뽑기.mjs
import { mkdir, writeFile, readdir, unlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "lab", "프롬프트");
const { EDITABLE_PROMPTS } = await import(path.join(root, "src/lib/study/gen/prompt-registry.ts"));
const { topicPlanSystem, DIGEST_KINDS } = await import(path.join(root, "src/lib/study/gen/digest.ts"));
const { DEFAULT_GEN_MODELS, genStepLabel } = await import(path.join(root, "src/lib/study/gen/types.ts"));

// 역할 · 받는 것 · 내는 것 · 쓰이는 때 · 주의 (C가 씀; 코드가 바뀌면 같이 고친다)
const DESC = {
  PLAN_COMMON: ["목차 호출의 지시문(system). 자료 전체를 읽고 뒤에 붙는 [작업]만 하라는 틀과 쪽 번호 규칙.", "자료 전체(쪽마다 [p.N] 글 + 쪽 그림)", "—(작업 지시가 정함)", "목차 → 바로 카드 / 목차 → 요약 → 카드 모두", "짧은 공통 틀이라 여기보다 [작업] 쪽을 고친다."],
  PLAN_TASK_CONCEPTS: ["목차 + 주제마다 배우는 항목(tN-cK)을 쓰게 하는 작업 지시. 앱 기본(목차 → 바로 카드)의 첫 호출.", "PLAN_COMMON과 같은 입력, 끝에 이 작업", "개요|쪽, tN|큰 주제|제목|쪽|관련|성격, tN-cK|항목|쪽, <<<OUTLINE_END>>>", "mapCards, conceptLines", "항목까지 쓰느라 출력이 길다(데드락 18초, 52쪽 50초). 끝 표시까지 다 써야 카드가 시작된다. 항목 줄이 없으면 주제 제목 하나가 항목이 된다."],
  PLAN_TASK: ["목차 + 주제 성격만 쓰는 작업 지시(항목 없음).", "PLAN_COMMON과 같은 입력", "개요|쪽, tN|큰 주제|제목|쪽|관련|성격, <<<OUTLINE_END>>>", "목차 → 요약 → 카드(digestStyle plan)", "성격이 주제 요약 지시를 고른다."],
  PLAN_TASK_GOALS: ["PLAN_TASK 뒤에 학습 목표까지 쓰게 하는 작업 지시.", "같음", "목차 + 목표|oN|동사|문장|주제|핵심·보조", "goalsInPlan(실험, 꺼짐)", "목차가 5초 → 10초로 늦어져 기본은 학습 목표를 따로 부른다."],
  SOURCE_EN: ["영어 자료일 때 글을 쓰는 모든 호출의 지시문 끝에 붙는 규칙.", "—", "한국어 문장, 용어는 한국어(영어), 인용·수식은 원문", "쪽 글자가 영어면 자동(sourceLanguage)", "앞의 표기 지시보다 우선한다고 적혀 있다. 그림 쪽 옮기기에는 붙지 않는다."],
  ORGANIZE: ["카드 호출 지시문의 맨 앞 공통 부분: 카드 종류와 모양, 근거 인용, 오답 메모, 제목 규칙. 예전 쪽 단위 정리에서 쓰던 그대로다.", "—", "카드 JSON", "모든 카드 호출(쪽 정리, 요약 줄 → 카드, 항목 → 카드)", "\"쪽당 1~3장\"이 여기 있다. MAP_CARD·DIGEST_CARD의 \"쪽당 장수 제한 대신 이 규칙\" 문장이 이것을 끈다."],
  MAP_CARD: ["항목(목차가 고른 이름과 쪽)마다 원문을 읽고 카드를 만들게 하는 지시. 앱 기본의 카드 호출.", "주제, 항목 줄(id·이름·쪽), 그 쪽 원문·그림, 용어 목록", "카드(covers = 항목 id)", "mapCards", "조건 이름은 용어 카드, 판정 규칙은 적용 범위를 condition에, 경계 칸은 원문에 있을 때만."],
  DIGEST_CARD: ["주제 요약의 본문 줄을 빠짐없이 카드로 덮게 하는 지시.", "본문 줄(id·이름·문장·쪽), 원문", "카드(covers = 본문 줄 id)", "목차 → 요약 → 카드", "lines에 없는 내용은 카드로 만들지 않는다."],
  GUIDE_ORGANIZE: ["카드 호출 지시문 맨 끝의 정리 기준. 출제기준 폴더의 공통.md + 정리.md에서 읽는다(파일이 원본).", "—", "—", "모든 카드 호출", "\"[정리-비교-1] 두 대상이 같은 기준으로 서술되면 비교 카드로 묶는다\"가 여기 있다. 원본은 출제기준/정리.md."],
  WRAP_SYSTEM: ["정리 글의 맨 앞 개요 두 문장과 주제마다 시험 전에 볼 것 한 줄.", "목차, 모든 주제의 본문 줄, 개요 쪽 원문", "개요: … / ## 핵심 정리", "요약 경로 모두", "목차 → 바로 카드에서는 본문 줄이 항목 이름뿐이라 얇아진다."],
  OBJECTIVES_SYSTEM: ["시험이라면 확인할 학습 목표 6~12개. 동사(떠올리기·구별·판정·계산·설명)가 문제 형식을 정한다.", "목차, 자료 전체 글", "목표|oN|동사|문장|주제들|핵심·보조", "luna 퀴즈", "목차가 나오면 카드와 같이 돈다(앱에서는 카드 단계에서 미리 받아 둠)."],
  Q_PICK_GOALS: ["학습 목표 하나에 문항 하나, 목표 동사로 형식을 골라 출제할 카드를 정한다.", "목표, 카드 줄(id·주제·종류·한 줄·오답), count, mix", "picks(카드·형식·물을 지점·목표) + 예비 6", "luna 퀴즈(목표가 있을 때)", "형식 비율은 한 형식이 절반을 넘지 않게만."],
  Q_PICK: ["목표 없이 카드와 주제 흐름만 보고 출제할 카드를 고른다.", "카드 줄, 주제", "picks + 예비", "luna 퀴즈(목표를 못 받았을 때)", ""],
  Q_MATERIAL: ["문제 재료: 맞는 진술 3개와 오개념 쌍 5개(한 단어만 다른 맞는/틀린 문장). OX·객관식·빈칸이 여기서 나온다.", "카드, focus, ask(물을 지점·목표), 주제 줄과 흔한 오해, 이웃 카드, 원문", "truths, pairs", "문항마다(서술형 제외)", "목차 → 바로 카드에서는 주제 줄 = 주제 카드 줄, 흔한 오해 = 카드 오답 메모."],
  Q_CHOICE: ["객관식 문제 글, 정답, 오답 후보 6개. 상황형 우선, 판단이 두세 갈래면 \"판단: 이유\" 꼴.", "재료 입력 + pairs", "stem, correct, candidates", "형식이 객관식일 때", "비교 카드는 ask가 이름 구별일 때만 이름 보기."],
  Q_SCORE: ["오답 후보마다 틀림 확실·그럴듯함·같은 꼴·같은 뜻을 매기고, 정답이 질문에 맞는지(fits)를 본다.", "문제 글, 정답, 후보들, 원문", "fits, items", "객관식", "코드가 틀림 확실 + 같은 꼴만 남겨 그럴듯한 순 3개를 고른다. 이 호출이 실패하면 그 카드는 객관식을 만들지 않는다."],
  Q_CLOZE: ["빈칸 문제 문장 하나와 비울 말 후보 3개.", "카드, focus, ask, 원문, truths", "sentence, blanks", "형식이 빈칸일 때", "코드가 일반어·답이 문장에 또 나오는 것·수식 깨짐을 거른다."],
  Q_WRITE: ["서술형: 왜·어떻게를 2~3문장으로 설명하게 하는 질문, 모범 답, 채점 요소.", "재료 입력(재료 호출 없이)", "stem, answer, points", "형식이 서술일 때", "이름·목록을 되묻는 질문은 코드가 버린다."],
  Q_EXPLAIN: ["다 만든 문제에 힌트, 보기별 한 줄 설명, 해설, 빈칸 인정 표기, 목표 한 줄.", "카드, 문제(객관식은 정답 첫 칸 + [정답]/[오답] 표시), 원문", "hint, notes, explanation, accepted, goal", "문항마다", "보기 순서는 고정해서 넘기고 화면에 낼 때 코드가 보기와 설명을 함께 섞는다."],
  VERIFY: ["정답을 모르고 카드 근거 쪽만 보고 문제를 따로 푼다. 답이 하나로 안 정해지거나 다르면 그 문항은 버린다.", "문제(객관식은 섞은 순서), 근거 쪽 원문", "choice/answer, unique, doubt", "객관식·OX·빈칸", "호출이 실패하면 보류(통과 아님)."],
  SAME_ANSWER: ["빈칸에서 따로 푼 답이 인정 답과 뜻이 같은지 판정.", "빈칸 문장, 인정 답, 다른 답", "same", "빈칸, 정확히 같지 않을 때만", ""],
};
const order = EDITABLE_PROMPTS.map((p) => p.name);
const files = [];
await mkdir(out, { recursive: true });
for (const f of await readdir(out)) if (f.endsWith(".md")) await unlink(f.startsWith("/") ? f : path.join(out, f)).catch(() => {});
const model = (step) => { const m = DEFAULT_GEN_MODELS[step]; return m ? `${m.model} ${m.effort}` : "—"; };
let i = 0;
for (const p of EDITABLE_PROMPTS) {
  i++;
  const [role, input, output, when, note] = DESC[p.name] ?? ["", "", "", "", ""];
  const name = `${String(i).padStart(2, "0")}_${p.name}.md`;
  const body = p.name === "GUIDE_ORGANIZE"
    ? "원본 파일: `출제기준/공통.md`(정리에 쓰는 [공통])와 `출제기준/정리.md`. 카드 호출 때 그 파일들의 해당 부분을 읽어 지시문 끝 `[정리 기준]` 아래에 붙인다. 실험실 프롬프트 탭에서 실행마다 덮어쓸 수 있다."
    : "```text\n" + p.text + "\n```";
  await writeFile(path.join(out, name), `# ${p.label} — \`${p.name}\`\n\n| | |\n|---|---|\n| 단계 | \`${p.step}\` (${genStepLabel[p.step] ?? p.step}) · 기본 모델 ${model(p.step)} |\n| 역할 | ${role} |\n| 받는 것 | ${input} |\n| 내는 것 | ${output} |\n| 쓰이는 때 | ${when || p.when || "—"} |\n| 주의 | ${note || "—"} |\n| 코드 | \`src/lib/study/gen/\` (prompt-registry.ts에서 위치 확인) |\n\n${body}\n`);
  files.push({ name, p, role });
}
// 주제 요약(rc-topic): 성격마다 지시가 다르다. 성격별로 하나씩.
const kinds = [...DIGEST_KINDS];
let topicMd = `# 주제 요약 — \`topicPlanSystem(성격)\`\n\n| | |\n|---|---|\n| 단계 | \`rc-topic\` (주제 정리 글) · 기본 모델 ${model("rc-topic")} (실험은 terra low로 돌림) |\n| 역할 | 주제 하나의 본문 줄 3~7개, 정리 한 줄, 쉬운 설명(해요체)과 흔한 오해. 성격(${kinds.join(", ")})마다 본문·쉬운 설명 규칙이 바뀐다. |\n| 받는 것 | 목차, 이 주제, 그 쪽 원문·관련 쪽·그림 |\n| 쓰이는 때 | 목차 → 요약 → 카드 (앱 기본인 목차 → 바로 카드에서는 부르지 않음) |\n| 주의 | 실험실 프롬프트 탭에서는 아직 고칠 수 없다(성격마다 달라서). |\n`;
for (const k of kinds) topicMd += `\n## 성격: ${k}\n\n\`\`\`text\n${topicPlanSystem(k, false)}\n\`\`\`\n`;
i++;
const topicName = `${String(i).padStart(2, "0")}_TOPIC_주제요약.md`;
await writeFile(path.join(out, topicName), topicMd);
const rows = files.map(({ name, p, role }) => `| [${p.label}](${encodeURI(name)}) | \`${p.step}\` | ${model(p.step)} | ${p.when ?? "늘"} | ${role} |`);
rows.push(`| [주제 요약(성격별)](${encodeURI(topicName)}) | \`rc-topic\` | ${model("rc-topic")} | 목차 → 요약 → 카드 | 주제 하나의 본문 줄·쉬운 설명·흔한 오해. 성격마다 지시가 다르다. |`);
await writeFile(path.join(out, "README.md"), `# 생성 엔진 프롬프트 모음 (C)

코드(\`src/lib/study/gen/\`)에 있는 프롬프트를 그대로 뽑은 것이다. **원본은 코드**이고 이 폴더는 보기용이다. 프롬프트를 고친 뒤 다시 만들기:
\`node --experimental-strip-types lab/프롬프트_뽑기.mjs\`

실행마다 고쳐 보려면 실험실(\`lab/엔진 실험 서버.cmd\` → http://127.0.0.1:3002/lab/gen) 실행 → **프롬프트** 탭. 거기서 고친 것은 그 실행에만 쓰인다.

## 앱 기본 흐름(목차 → 바로 카드)에서 쓰이는 순서
1. 목차: \`PLAN_COMMON\` + \`PLAN_TASK_CONCEPTS\` (+ 영어 자료면 \`SOURCE_EN\`)
2. 카드: \`ORGANIZE\` + \`MAP_CARD\` + 정리 기준(\`출제기준/공통.md\`·\`정리.md\`) (+ \`SOURCE_EN\`)
3. 같이: 학습 목표 \`OBJECTIVES_SYSTEM\`, 개요·핵심 정리 \`WRAP_SYSTEM\`
4. 문제(학습자가 누르면): \`Q_PICK_GOALS\` → 문항마다 \`Q_MATERIAL\` → \`Q_CHOICE\`+\`Q_SCORE\` / \`Q_CLOZE\` / \`Q_WRITE\` (OX는 코드가 재료에서) → \`Q_EXPLAIN\` + 정답 확인 \`VERIFY\`(빈칸은 \`SAME_ANSWER\`)

## 목록
| 프롬프트 | 단계 | 기본 모델 | 쓰이는 때 | 역할 |
|---|---|---|---|---|
${rows.join("\n")}
`);
// 역할과 설명 한 파일 (11/5 사용자 "역할과 설명도 md로")
let guide = `# 프롬프트별 역할과 설명\n\n프롬프트 원문은 같은 폴더의 번호 붙은 파일에 있다. 목록·흐름은 [README](README.md).\n`;
for (const { name, p } of files) {
  const [role, input, output, when, note] = DESC[p.name] ?? ["", "", "", "", ""];
  guide += `\n## ${p.label} — \`${p.name}\`\n- 파일: [${name}](${encodeURI(name)})\n- 단계: \`${p.step}\` (${genStepLabel[p.step] ?? p.step}) · 기본 모델 ${model(p.step)}\n- 역할: ${role}\n- 받는 것: ${input}\n- 내는 것: ${output}\n- 쓰이는 때: ${when || p.when || "—"}\n- 주의: ${note || "—"}\n`;
}
guide += `\n## 주제 요약(성격별) — \`topicPlanSystem\`\n- 파일: [${topicName}](${encodeURI(topicName)})\n- 단계: \`rc-topic\` · 기본 모델 ${model("rc-topic")}\n- 역할: 주제 하나의 본문 줄 3~7개, 정리 한 줄, 쉬운 설명(해요체)과 흔한 오해. 성격마다 본문·쉬운 설명 규칙이 바뀐다.\n- 쓰이는 때: 목차 → 요약 → 카드 (앱 기본에서는 부르지 않음)\n- 주의: 실험실에서 아직 고칠 수 없다.\n`;
await writeFile(path.join(out, "00_역할과_설명.md"), guide);
console.log(`${files.length + 1}개 + README + 역할과 설명 → ${out}`);
