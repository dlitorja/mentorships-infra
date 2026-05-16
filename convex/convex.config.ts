import { defineApp } from "convex/server";
import migrations from "@convex-dev/migrations/convex.config.js";

const convex = defineApp();
convex.use(migrations);

export default convex;
