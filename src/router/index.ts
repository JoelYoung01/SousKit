import { useSessionStore } from "@/stores/session";
import { legacyRedirects, paths } from "@/sitemap";
import { watch } from "vue";
import { createRouter, createWebHistory, type RouteRecordRaw } from "vue-router";

const routes: RouteRecordRaw[] = [
  {
    path: paths.login,
    name: "login",
    component: () => import("@/views/LoginView.vue"),
    meta: { noAuthReq: true }
  },
  {
    path: paths.register,
    name: "register",
    component: () => import("@/views/RegisterView.vue"),
    meta: { noAuthReq: true }
  },
  {
    path: paths.verifyEmail,
    name: "verify-email",
    component: () => import("@/views/VerifyEmailView.vue"),
    meta: { noAuthReq: true }
  },
  {
    path: "/",
    component: () => import("@/layouts/AppShell.vue"),
    children: [
      { path: "", redirect: { name: "home" } },
      {
        path: "home",
        name: "home",
        component: () => import("@/views/HomeView.vue")
      },
      {
        path: "recipes",
        name: "recipes",
        component: () => import("@/views/recipes/RecipesView.vue")
      },
      {
        path: "recipes/new",
        name: "recipe-new",
        component: () => import("@/views/recipes/RecipeEditView.vue")
      },
      {
        path: "recipes/import",
        name: "recipe-import",
        component: () => import("@/views/recipes/RecipeImportView.vue")
      },
      {
        path: "recipes/:recipeId(\\d+)",
        name: "recipe-detail",
        component: () => import("@/views/recipes/RecipeDetailView.vue")
      },
      {
        path: "recipes/:recipeId(\\d+)/edit",
        name: "recipe-edit",
        component: () => import("@/views/recipes/RecipeEditView.vue")
      },
      {
        path: "planner",
        name: "planner",
        component: () => import("@/views/planner/PlannerView.vue")
      },
      {
        path: "planner/fill",
        name: "planner-fill",
        component: () => import("@/views/planner/MealPlanWizardView.vue")
      },
      {
        path: "list",
        name: "list",
        component: () => import("@/views/list/ShoppingListView.vue")
      },
      {
        path: "account",
        name: "account",
        component: () => import("@/views/AccountView.vue")
      },
      {
        path: "join/:token",
        name: "join-household",
        component: () => import("@/views/JoinHouseholdView.vue")
      },
      {
        path: "users/:userId(\\d+)",
        name: "public-user",
        component: () => import("@/views/PublicUserView.vue")
      }
    ]
  },
  ...legacyRedirects.map(
    (r): RouteRecordRaw => ({
      path: r.from,
      redirect: (to) => {
        let target = r.to;
        for (const [key, value] of Object.entries(to.params)) {
          target = target.replace(`:${key}`, String(value));
        }
        return target;
      }
    })
  ),
  {
    path: "/:pathMatch(.*)*",
    name: "not-found",
    component: () => import("@/views/NotFoundView.vue")
  }
];

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
  scrollBehavior() {
    // Document scroll is locked; reset the app shell scroller instead.
    requestAnimationFrame(() => {
      document.querySelector<HTMLElement>("[data-app-scroll]")?.scrollTo({ top: 0 });
    });
    return false;
  }
});

router.beforeEach(async (to) => {
  const session = useSessionStore();

  // Wait briefly if session check is in flight on first load
  if (session.loading) {
    await new Promise<void>((resolve) => {
      const stop = watch(
        () => session.loading,
        (loading) => {
          if (!loading) {
            stop();
            resolve();
          }
        },
        { immediate: true }
      );
    });
  }

  if (!to.meta.noAuthReq && !session.currentUser) {
    return {
      name: "login",
      query: { redirectUrl: to.fullPath }
    };
  }

  if (
    (to.name === "login" || to.name === "register" || to.name === "verify-email") &&
    session.currentUser
  ) {
    const redirect = typeof to.query.redirectUrl === "string" ? to.query.redirectUrl : paths.home;
    return redirect;
  }
});

export default router;
