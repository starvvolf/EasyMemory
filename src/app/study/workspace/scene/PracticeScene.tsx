"use client";
// 실습 전용 형식(13 어디에 넣을까 · 14 시간 순서 표 · 15 명령 한 줄 · 16 작은 재현 프로젝트 · 17 원래 자리로)의 몸통.
// 자리 표시: 실습 갈래 구현이 이 파일을 채운다(src/lib/scene/practice/). 답은 글(JSON 등) 하나로 onAnswer에 넘긴다.
import { useState } from "react";

export function PracticeBody({ scene, disabled, onAnswer }: { scene: { format: string; practice?: Record<string, unknown> }; disabled: boolean; onAnswer: (answer: string) => void }) {
  const [v, setV] = useState("");
  return <label className="sc-field"><span className="small muted">답 ({scene.format})</span>
    <textarea className="sc-code" rows={3} value={v} disabled={disabled} onChange={(e) => { setV(e.target.value); onAnswer(e.target.value); }} /></label>;
}
