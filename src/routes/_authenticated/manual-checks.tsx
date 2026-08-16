import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/lib/org";
import {
  PLATFORM_LABELS,
  MANUAL_DISCLAIMER,
  formatSeoul,
  nowSeoulLocalInput,
  seoulLocalToIso,
} from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/manual-checks")({
  head: () => ({
    meta: [
      { title: "수동 UI 점검 · AI Visibility Lab" },
      { name: "description", content: "사람이 직접 확인한 AI 답변 결과를 기록하고 스크린샷을 보관합니다." },
      { property: "og:title", content: "수동 UI 점검 · AI Visibility Lab" },
      { property: "og:description", content: "AI 답변 수동 점검 기록 관리" },
    ],
  }),
  component: ManualChecksPage,
});

type Check = {
  id: string;
  business_id: string;
  question_id: string | null;
  platform: string;
  prompt_text: string;
  response_text: string;
  was_client_mentioned: boolean;
  client_position: number | null;
  observed_at: string;
  logged_in: boolean;
  personalized: boolean;
  screenshot_path: string | null;
  notes: string | null;
};

function ManualChecksPage() {
  const { activeOrgId, canWrite } = useOrg();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [form, setForm] = useState({
    id: "",
    business_id: "",
    question_id: "",
    platform: "chatgpt_ui",
    prompt_text: "",
    response_text: "",
    was_client_mentioned: false,
    client_position: "",
    observed_at: nowSeoulLocalInput(),
    logged_in: false,
    personalized: false,
    notes: "",
  });

  const { data: businesses = [] } = useQuery({
    queryKey: ["businesses-min", activeOrgId],
    enabled: !!activeOrgId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("businesses")
        .select("id, name, is_client_business")
        .eq("org_id", activeOrgId!)
        .eq("active", true)
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: questions = [] } = useQuery({
    queryKey: ["all-questions", activeOrgId],
    enabled: !!activeOrgId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("questions")
        .select("id, prompt_text, active")
        .eq("org_id", activeOrgId!)
        .eq("active", true)
        .order("created_at");
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: checks = [] } = useQuery({
    queryKey: ["manual-checks", activeOrgId],
    enabled: !!activeOrgId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("manual_ui_checks")
        .select(
          "id, business_id, question_id, platform, prompt_text, response_text, was_client_mentioned, client_position, observed_at, logged_in, personalized, screenshot_path, notes",
        )
        .eq("org_id", activeOrgId!)
        .order("observed_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Check[];
    },
  });

  const save = useMutation({
    mutationFn: async () => {
      let screenshotPath: string | null = null;
      if (file) {
        const ext = file.name.split(".").pop() || "png";
        const path = `${activeOrgId}/${crypto.randomUUID()}.${ext}`;
        const { error: upErr } = await supabase.storage.from("manual-ui-screenshots").upload(path, file);
        if (upErr) throw upErr;
        screenshotPath = path;
      }
      const payload = {
        org_id: activeOrgId!,
        business_id: form.business_id,
        question_id: form.question_id || null,
        platform: form.platform as "chatgpt_ui" | "gemini_app" | "perplexity_web",
        prompt_text: form.prompt_text.trim(),
        response_text: form.response_text.trim(),
        was_client_mentioned: form.was_client_mentioned,
        client_position: form.client_position ? Number(form.client_position) : null,
        observed_at: seoulLocalToIso(form.observed_at),
        logged_in: form.logged_in,
        personalized: form.personalized,
        notes: form.notes.trim() || null,
        ...(screenshotPath ? { screenshot_path: screenshotPath } : {}),
      };
      if (form.id) {
        const { error } = await supabase.from("manual_ui_checks").update(payload).eq("id", form.id);
        if (error) throw error;
      } else {
        const { data: userRes } = await supabase.auth.getUser();
        const { error } = await supabase
          .from("manual_ui_checks")
          .insert({ ...payload, created_by: userRes.user?.id ?? null });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success("점검 기록이 저장되었습니다.");
      setOpen(false);
      setFile(null);
      qc.invalidateQueries({ queryKey: ["manual-checks", activeOrgId] });
    },
    onError: (e: Error) => toast.error(`저장 실패: ${e.message}`),
  });

  async function viewScreenshot(path: string) {
    const { data, error } = await supabase.storage.from("manual-ui-screenshots").createSignedUrl(path, 60);
    if (error || !data) {
      toast.error("스크린샷을 불러오지 못했습니다.");
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener");
  }

  const bizName = (id: string) => businesses.find((b) => b.id === id)?.name ?? "-";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">수동 UI 점검</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            사람이 직접 확인한 AI 답변을 기록합니다. 자동 측정은 이번 단계에서 제공하지 않습니다.
          </p>
        </div>
        {canWrite && (
          <Button
            onClick={() => {
              setForm({
                id: "",
                business_id: businesses[0]?.id ?? "",
                question_id: "",
                platform: "chatgpt_ui",
                prompt_text: "",
                response_text: "",
                was_client_mentioned: false,
                client_position: "",
                observed_at: nowSeoulLocalInput(),
                logged_in: false,
                personalized: false,
                notes: "",
              });
              setFile(null);
              setOpen(true);
            }}
          >
            점검 기록 추가
          </Button>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">점검 기록 {checks.length}건</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>측정 시각(KST)</TableHead>
                <TableHead>업체</TableHead>
                <TableHead>플랫폼</TableHead>
                <TableHead>질문</TableHead>
                <TableHead>포함</TableHead>
                <TableHead>순서</TableHead>
                <TableHead>조건</TableHead>
                <TableHead className="text-right">자료</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {checks.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="whitespace-nowrap text-xs">{formatSeoul(c.observed_at)}</TableCell>
                  <TableCell className="whitespace-nowrap text-sm">{bizName(c.business_id)}</TableCell>
                  <TableCell className="whitespace-nowrap text-sm">{PLATFORM_LABELS[c.platform]}</TableCell>
                  <TableCell className="max-w-[280px] truncate text-sm">{c.prompt_text}</TableCell>
                  <TableCell>
                    <Badge variant={c.was_client_mentioned ? "default" : "secondary"}>
                      {c.was_client_mentioned ? "포함" : "미포함"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm">{c.client_position ?? "-"}</TableCell>
                  <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                    {c.logged_in ? "로그인" : "비로그인"} / {c.personalized ? "개인화" : "비개인화"}
                  </TableCell>
                  <TableCell className="space-x-2 text-right">
                    {c.screenshot_path && (
                      <Button variant="outline" size="sm" onClick={() => viewScreenshot(c.screenshot_path!)}>
                        스크린샷
                      </Button>
                    )}
                    {canWrite && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setForm({
                            id: c.id,
                            business_id: c.business_id,
                            question_id: c.question_id ?? "",
                            platform: c.platform,
                            prompt_text: c.prompt_text,
                            response_text: c.response_text,
                            was_client_mentioned: c.was_client_mentioned,
                            client_position: c.client_position ? String(c.client_position) : "",
                            observed_at: new Date(c.observed_at).toISOString().slice(0, 16),
                            logged_in: c.logged_in,
                            personalized: c.personalized,
                            notes: c.notes ?? "",
                          });
                          setFile(null);
                          setOpen(true);
                        }}
                      >
                        수정
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {checks.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="py-8 text-center text-sm text-muted-foreground">
                    기록된 수동 점검이 없습니다.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">{MANUAL_DISCLAIMER}</p>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{form.id ? "점검 기록 수정" : "점검 기록 추가"}</DialogTitle>
            <DialogDescription>확인한 플랫폼, 질문, 답변 원문과 조건을 정확히 남겨 주세요.</DialogDescription>
          </DialogHeader>
          <form
            id="mc-form"
            className="grid gap-4 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate();
            }}
          >
            <div className="space-y-2">
              <Label>업체</Label>
              <Select value={form.business_id} onValueChange={(v) => setForm({ ...form, business_id: v })}>
                <SelectTrigger>
                  <SelectValue placeholder="업체 선택" />
                </SelectTrigger>
                <SelectContent>
                  {businesses.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>플랫폼</Label>
              <Select value={form.platform} onValueChange={(v) => setForm({ ...form, platform: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(PLATFORM_LABELS).map(([k, v]) => (
                    <SelectItem key={k} value={k}>
                      {v}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label>등록된 질문 연결 (선택)</Label>
              <Select
                value={form.question_id}
                onValueChange={(v) => {
                  const q = questions.find((x) => x.id === v);
                  setForm({ ...form, question_id: v, prompt_text: q?.prompt_text ?? form.prompt_text });
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="질문 선택 (선택 사항)" />
                </SelectTrigger>
                <SelectContent>
                  {questions.map((q) => (
                    <SelectItem key={q.id} value={q.id}>
                      {q.prompt_text.slice(0, 60)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="mc-prompt">질문 문구</Label>
              <Textarea
                id="mc-prompt"
                required
                rows={2}
                value={form.prompt_text}
                onChange={(e) => setForm({ ...form, prompt_text: e.target.value })}
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="mc-resp">AI 답변 원문</Label>
              <Textarea
                id="mc-resp"
                required
                rows={6}
                value={form.response_text}
                onChange={(e) => setForm({ ...form, response_text: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="mc-observed">측정 시각 (KST)</Label>
              <Input
                id="mc-observed"
                type="datetime-local"
                value={form.observed_at}
                onChange={(e) => setForm({ ...form, observed_at: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="mc-pos">언급 순서 (숫자)</Label>
              <Input
                id="mc-pos"
                type="number"
                min="1"
                value={form.client_position}
                onChange={(e) => setForm({ ...form, client_position: e.target.value })}
              />
            </div>
            <div className="flex items-center justify-between rounded-md border p-3">
              <p className="text-sm font-medium">업체 포함 여부</p>
              <Switch
                checked={form.was_client_mentioned}
                onCheckedChange={(v) => setForm({ ...form, was_client_mentioned: v })}
              />
            </div>
            <div className="flex items-center justify-between rounded-md border p-3">
              <p className="text-sm font-medium">로그인 상태</p>
              <Switch checked={form.logged_in} onCheckedChange={(v) => setForm({ ...form, logged_in: v })} />
            </div>
            <div className="flex items-center justify-between rounded-md border p-3 sm:col-span-2">
              <p className="text-sm font-medium">개인화 가능성</p>
              <Switch checked={form.personalized} onCheckedChange={(v) => setForm({ ...form, personalized: v })} />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="mc-file">스크린샷 업로드</Label>
              <Input
                id="mc-file"
                type="file"
                accept="image/*"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="mc-notes">내부 메모</Label>
              <Textarea
                id="mc-notes"
                rows={2}
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
              />
            </div>
          </form>
          <DialogFooter>
            <Button type="submit" form="mc-form" disabled={save.isPending || !form.business_id}>
              저장
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
