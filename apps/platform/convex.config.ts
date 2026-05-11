import { defineApp } from "convex/server";
import underscore from "lodash";

const app = defineApp();

// Allow lodash
app.add(underscore);

export default app;