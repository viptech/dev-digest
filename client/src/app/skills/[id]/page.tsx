"use client";

import { useParams } from "next/navigation";
import { SkillEditorView } from "./_components/SkillEditorView";

/* Route: /skills/:id — Skill Editor (SPEC-06). Thin page; all `?tab=`/
   ErrorState/header logic lives in SkillEditorView so it stays testable
   without mocking `useParams`. */
export default function SkillEditorPage() {
  const { id } = useParams<{ id: string }>();
  return <SkillEditorView id={id} />;
}
