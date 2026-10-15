import { Router } from "express";
import * as Sentry from "@sentry/node";
import { asyncHandler, parseGenerateQuest } from "../http";
import type { AppDependencies } from "../ports";
import { runQuestPipeline } from "../pipelines/questPipeline";

/**
 * Quest routes bound to the supplied collaborators.
 *
 * @param deps - Model and narrator used to build one walk.
 */
export function createQuestRouter(deps: AppDependencies): Router {
  const router = Router();
  router.post(
    "/generate",
    asyncHandler(async (req, res) => {
      const input = parseGenerateQuest(req.body);
      const result = await runQuestPipeline(deps, input);
      Sentry.getActiveSpan()?.setAttribute("quest.chars", result.questText.length);
      res.status(200).json(result);
    }),
  );
  return router;
}
