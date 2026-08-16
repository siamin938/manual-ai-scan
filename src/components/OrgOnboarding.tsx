import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/lib/org";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";

const ERRORS: Record<string, string> = {
  INVALID_ORGANIZATION_NAME: "조직 이름은 2자 이상이어야 합니다.",
  INVALID_SLUG: "슬러그는 영문 소문자, 숫자, 하이픈만 사용할 수 있습니다.",
  SLUG_ALREADY_EXISTS: "이미 사용 중인 슬러그입니다.",
  AUTH_REQUIRED: "로그인이 필요합니다.",
};

export function OrgOnboarding() {
  const { refetch } = useOrg();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [busy, setBusy] = useState(false);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.rpc("create_organization_with_owner", {
      p_name: name,
      p_slug: slug,
    });
    setBusy(false);
    if (error) {
      const key = Object.keys(ERRORS).find((k) => error.message.includes(k));
      toast.error(key ? ERRORS[key]! : `조직 생성 실패: ${error.message}`);
      return;
    }
    toast.success("조직이 생성되었습니다.");
    refetch();
  }

  return (
    <div className="mx-auto max-w-lg py-10">
      <Card>
        <CardHeader>
          <CardTitle>조직 만들기</CardTitle>
          <CardDescription>
            소속된 조직이 없습니다. 새 조직을 만들면 소유자(owner) 권한이 부여됩니다.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={create}>
            <div className="space-y-2">
              <Label htmlFor="org-name">조직 이름</Label>
              <Input
                id="org-name"
                required
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                }}
                placeholder="예: 시아민 마케팅"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="org-slug">슬러그</Label>
              <Input
                id="org-slug"
                required
                value={slug}
                onChange={(e) => setSlug(e.target.value.toLowerCase())}
                placeholder="예: siamin-marketing"
              />
              <p className="text-xs text-muted-foreground">영문 소문자, 숫자, 하이픈만 사용 가능합니다.</p>
            </div>
            <Button type="submit" className="w-full" disabled={busy}>
              조직 생성
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
