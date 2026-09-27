# Consolidação de branches — 2026-09-26

Este registro preserva os HEADs remotos observados imediatamente antes da consolidação para `main`.

## Decisão

- `main` é a única linha ativa de desenvolvimento.
- branches antigas não são fonte de produto nem podem reativar funcionalidade removida;
- Tópicos/Discussões permanecem fora da superfície de Comunidades;
- nenhuma ação deste saneamento autoriza deploy de produção.

## Referência da main no inventário

`e9ac96cb4f6525908e24014f495b498e1f28eebe`

## HEADs arquivados

| Branch | SHA antes da consolidação |
| --- | --- |
| `age/declaration-first-policy` | `0d2b4c19616857ee91b7fa0c6700a2560f397d1d` |
| `age/provisional-self-declaration-access` | `1ec9f05a08ac53e675e5f0528a0b2f8bf0d0a482` |
| `age/self-attestation-rollout` | `209d4aa0cd338134e28f6082fc4a0b7bd3d919aa` |
| `agent/fix-photo-friends-audience` | `5ef5ac65574a4e76b5a162a1879b5f8ca30259d8` |
| `agent/harden-friendship-authority` | `e521c17c108bcc87d651beaaee6a001c3c22034b` |
| `audit/account-subscription-lifecycle` | `567100543dcbacd0554ae73e5ab1046b38681f2b` |
| `audit/community-final-maturity` | `9600652d8b19e745780aad151c46e2022080fac0` |
| `audit/global-repository-hardening` | `0fd3a3d4fbf23e374f110e293fb889ce0f179f4c` |
| `audit/recurring-billing-maturity` | `556ddb6ea1315e0134fc493736c04337bb8ec5ee` |
| `billing-canonical-access` | `f845540750778a8828caf13f5aa6797a3ae73804` |
| `billing/asaas-recurring-production` | `b0e454c9faedb7744adfde427476f0abd0c39d78` |
| `billing/canonical-pricing-lifecycle` | `a168c245083d81a62c718001734f0bc6ebf0fadc` |
| `chore/cleanup-safe-legacy-residue` | `28ec09478c4a046a1327b2c161ae02fd79006f8b` |
| `chore/community-topics-product-freeze` | `2d9d3d4a48845232f2e2b203ff67140a6fcdefe4` |
| `chore/validate-profile-authority-20260913` | `28dd093a7e864fa6b27e908266e4abd78398a3ba` |
| `cleanup/legacy-error-orphans` | `39d10c2264196b7cd9b489b84a2066996212b88c` |
| `codex/access-control-application-errors` | `90c1a0715730f3a8760299697db054a611566ba9` |
| `codex/account-lifecycle-application-errors` | `f254ab0b3ad65219306a8eeb46440ab61a082cd4` |
| `codex/account-moderation-application-errors` | `eb16d7d3c49dd5b9834e7ba765d6811d8909b69d` |
| `codex/account-reauthentication-application-errors` | `0c9ecbc231a42272cff94f056bd576a7a6b8bafb` |
| `codex/age-verification-application-errors` | `f2a68036f0a3ae18ae4f85f026d47063a2fb6b44` |
| `codex/application-error-canonicalization-batch-1` | `41399cc74ef83fbaf5d34e93c51ec6b896bfd83d` |
| `codex/auth-orchestrator-application-errors` | `c43084779d02b8cf42a3490509f7e5198b5268ce` |
| `codex/auth-post-login-effects-application-errors` | `19a6343fff3914822c7b4c788bcb190ef2d3d6a7` |
| `codex/auth-route-context-application-errors` | `628cd96b6024d86c1cd35c78d2c235dca46b2320` |
| `codex/auth-session-monitor-application-errors` | `e69f58376d0a1d469ac360ca3ac692042cb8f610` |
| `codex/chat-list-application-errors` | `3e2bce855685e4ca4bd74aa43f290bacf44fe0ff` |
| `codex/chat-service-application-errors` | `38f9ae43216872eb168f4789c2fddd970db5f493` |
| `codex/direct-chat-facade-application-errors` | `7df1e56da51629d771caa814ccd8b4515d74a24b` |
| `codex/direct-chat-service-application-errors` | `80f0e474bdc6be8ca0eca2fa8be18e6595dd548d` |
| `codex/direct-thread-application-errors` | `61fc5e53e93df573935b8da4becfe10f151bcb99` |
| `codex/email-verification-application-errors` | `c25a68fb98a7183f3f014c7c424c957233d579e4` |
| `codex/email-verification-gate-application-errors` | `75af6b71f9aa074d31636cefc7864006fee02b43` |
| `codex/login-service-application-errors` | `a2ac62086f357d8fc94075d78a0ea23d1276301c` |
| `codex/logout-application-errors` | `8ef166eb70ae76e2736bdbcc78eb6871e39a5fdd` |
| `codex/password-reset-code-validation-application-errors` | `5860b2f1c5bd1a57365e34619913223ea1e49b6e` |
| `codex/register-service-application-errors` | `1dc61098d1cb8dd8a91c9cb77f6f6f85ba5dbb8e` |
| `codex/registration-recovery-application-errors` | `42c1b660777c7618d0904ec511f8156edd49c355` |
| `codex/social-auth-application-errors` | `c2004fdc3fec35d8b1086351a6862fbebf3d84dc` |
| `community/capacity-regularization` | `10109af700f66de8b8c5041988e0911de0302357` |
| `community/capacity-regularization-backfill` | `1b2fadd1e10f800b0e8ac2bdb67f1bc930998850` |
| `community/capacity-regularization-clock` | `8beb7f0ab8c7c004666b659c8a1037e7fbad162b` |
| `community/capacity-regularization-management` | `1ba7e545dc106380ec2a08af99f7837618464b69` |
| `community/incremental-consumption-gains` | `bbaf777986fe083a09764dcc48ca00c67aefe4a4` |
| `compliance/harden-minor-report-flow` | `dd7d9c2241cc832dbed3f6b0decd26923dc5141f` |
| `docs/production-deployment-runbook` | `e746d3b861c4fc415a8c30022502646159905736` |
| `feat/community-admin-search` | `d2fbb3a73c47e4d9741c9937500a0884692734fa` |
| `feat/community-capacity-regularization-governance` | `1b2d75c7b90bdea110bf245711732a8e70861399` |
| `feat/community-content-explore-distribution` | `dfecc8c4a3486ee4b544be0383eb00622734386a` |
| `feat/community-cost-operations-baseline` | `0ed015838dcb3182295d5356502bff20bef2da47` |
| `feat/community-distribution-membership-scope` | `60d1c8fe8e5790e09620429e2d56dc0681b00a7d` |
| `feat/community-distribution-telemetry` | `9bb76f260fb0a542e2ec0ac92c9dc5a774eac4dc` |
| `feat/community-explore-distribution` | `d4ace2874fd63e9855132d76ec804a67475a8c81` |
| `feat/community-internal-search` | `74d0e8df21afd217a3e118420eec0d59e281be7d` |
| `feat/community-my-high-participation-ux` | `bd32094cf574669fbd0f33b5daa4b7253bdaab82` |
| `feat/explore-community-distribution` | `5ef7d4726f464cf21f8f6ddd924aaaf7d4295634` |
| `feat/recurring-subscription-downgrade` | `dc508815c15b1bee99c054429c949d084bf24c4a` |
| `feature/community-discussions` | `8ba3e39d4f74d7a27ed18753449da2f68234b2b4` |
| `fix/account-community-owner-availability` | `b1aed665890cb0f6c4015463ca5c8de578125317` |
| `fix/account-deletion-cross-domain-lifecycle` | `1c7ef6bae47d8654593ee07f7078ef3c69678f1a` |
| `fix/account-lifecycle-billing-durable-reconcile` | `98866dd7eddba80f07fc9bf4aa9371523d4a8720` |
| `fix/account-lifecycle-billing-reconciliation` | `f0a159c3abbc76dc557bc006cb9504559bd09301` |
| `fix/account-lifecycle-billing-status` | `036fdf67815b9b065124be78381239adca85b326` |
| `fix/account-suspension-billing` | `f10529af13e0380048136a38b5dddcd2f593a083` |
| `fix/account-suspension-expiry` | `e380f6f73ce9ddb3a77600a2e3cde24ae46534ad` |
| `fix/account-suspension-expiry-rebased` | `a71744271566a607cbc599f97d992530d815db6a` |
| `fix/additional-trigger-type-migrations` | `8bae95439aad4f5a67d6cf72a13e576bf12f45cc` |
| `fix/adult-social-gating` | `5eaa88a1086d4298074c08896d32afa86c9626c1` |
| `fix/adult-social-runtime-gate` | `290f645b5899fd8d26806a3c4d153c6189f4bf02` |
| `fix/adult-social-runtime-gating` | `f0f21d621a2b1d5de81227fe3f11cae32a9c877e` |
| `fix/age-emulator-export-guard` | `de34d17cdb06b69ee37daeea40a7f4eb0eea42ee` |
| `fix/age-navigation-cancel` | `e7b5fad2c05f95e2fce4b36e7f3abfee60b12862` |
| `fix/canonical-host-error-presentation` | `a700ba99d22785304f5ad7d23a6a036ca769e41a` |
| `fix/close-room-surface-redundancy` | `c2a89e8cc0a3911e37b392a46192414c100e7eac` |
| `fix/community-boost-authority-loss-eager-cancel` | `fcb514ac65862bdaabd29590b9b7d0535aff8442` |
| `fix/community-boost-ownership-boundary` | `7378d93098b20cb28fa07da75929b09781531660` |
| `fix/community-boost-ownership-financial-boundary-current` | `3cc6c75714b4ef58ad1cda25c339506dd3439f14` |
| `fix/community-cost-gcloud-windows` | `de4be8dd03cb9e97f6f33e65b382a22108458255` |
| `fix/community-cost-monitoring-resource-type` | `ac664daa63b9cd1dcde99d2d225b9193d8c7cf72` |
| `fix/community-discovery-canonical-order` | `c27dbe28c449c0a93a36829f62e66e74fe076e54` |
| `fix/community-discovery-canonical-order-current` | `b4fc26fa71128ee1bc71acbca91b2552e8eac5ea` |
| `fix/community-discovery-membership-reconciliation` | `4356317451661613aab1cdf63128672d02a1f341` |
| `fix/community-final-error-boundary` | `01f5e371730aff3e4d5068c3d0d26e6a0baa6e9e` |
| `fix/community-member-count-consistency` | `8609ea0319b07374ef7baab7e7ab34db8e919446` |
| `fix/community-membership-cache-invalidation-current` | `79a932a7a36773d114dfc34b3f71bba63549027e` |
| `fix/community-membership-notification-lifecycle` | `941fabe62f50ac17797f2857c8c7693632bf6614` |
| `fix/community-membership-notifications` | `96e774ac18521715153adb43a2934e66e4ddd0a8` |
| `fix/community-mural-bilateral-block-followup` | `86fb13ff216bd8d0fa9116dfa6459b8d83f120a8` |
| `fix/community-mural-bilateral-block-policy` | `cddb11251ffef495531f1b6a568ff018f5024669` |
| `fix/community-notification-summary-trigger-migration` | `a04871943a1ae90d79624b6ae4d066940d9f68e9` |
| `fix/community-owner-successor-pagination` | `2f4407f0002f99407991c2e87cc599818ad5f974` |
| `fix/community-paused-membership-approval` | `2007f8dca2bc427db62d1512845401c0226f03aa` |
| `fix/community-preview-tabs-a11y` | `910c35713960885401acd1d84e600a0cb62d02f5` |
| `fix/community-profile-discovery-filter-scope` | `48fa379fcb048d7440c059d7e31eb57b27073abc` |
| `fix/community-ranking-v3-real-data-shadow` | `ebd53b4dadf5fc09bad047bf2bb1db527038070d` |
| `fix/community-trigger-type-migration` | `aca7d15522a2cc44263ddea593c89d42faea34fd` |
| `fix/dev-emulator-callable-readiness` | `a555ce91e2068d5e8167dca747b1f3fdd813132c` |
| `fix/friendship-backend-authority` | `797959e48490bb3fecd0c973d778e2348213c34d` |
| `fix/functions-export-check-local-env` | `41d692c6f763293849d78e20828e8b69ece48013` |
| `fix/orphan-audit-gitignore` | `f86633afec4aabb43c034c119ff5b237413942ec` |
| `fix/p0-age-verification-boundary` | `0c7801801852da4756fe3c379086a7a994c1a2fe` |
| `fix/package-script-reference-integrity` | `457536b0acfedc1bf03ad7339ad5ea019e0e5a8c` |
| `guard/community-observe-only-calibration` | `24b2f771059403413b1dfe6c640268073e4e0677` |
| `hardening/account-lifecycle-mutations` | `b2aa1dbaf079f3af9efe6f9aea60fe2ac849f4ac` |
| `hardening/minor-safety-transversal` | `bb110399972ac6932ac42ae0e68b204b0c406362` |
| `ops/community-cost-gcp-bootstrap` | `858bae56d006e71fc86348e59f176c388beb01fd` |
| `ops/community-cost-production-activation` | `650031eaf82b48c59f10e6bb0c3b6dc95aa55abb` |
| `perf/community-notification-summary-scale` | `754aeaf9df32fb80f022a80cde89fbfb797dda9b` |
| `refactor/canonize-admin-billing-errors` | `b915fdbeac4256e341193148825cfaaf9fcb94d5` |
| `refactor/canonize-chat-room-errors` | `6603c478d23c79d591f071bc35a1e4fc9c6dd76f` |
| `refactor/canonize-firestore-errors` | `d4cd428fde8ed36e120429f8666b72570f4b3652` |
| `refactor/close-error-and-explore-legacy-cleanup` | `7d44ba9d899a9f38d50d34f6ae10e474fde25719` |
| `refactor/community-discovery-mine-view` | `d63f473bbc3872e1d008ec226c5d799c08148e88` |
| `refactor/community-error-boundary-main` | `adb109201d06495196ceb95cbeeeb8a6afd47d19` |
| `refactor/community-feed-comment-state` | `8c48fb58b0cf5ff02bb5bc8a741d3a053ac41619` |
| `refactor/community-god-components` | `5b7a51ed14788a28e172841a348b291b5e96a3f7` |
| `refactor/notifications-canonical-application-error` | `60f14b510eb2a19e16eb755c47ae7a4268ce5fc3` |
| `refactor/preferences-application-error-canonization` | `666c1ac32c847207e55ab5fd2e97e93b88058358` |
| `refactor/profile-explore-error-boundary` | `cf629d6f7dd4befdaa69313e8fb735cf749d2c42` |
| `refactor/registration-bootstrap-error-ownership` | `fdee6119b1ed80e6a1df4c0dd5d3fae809ac307d` |
| `refactor/social-space-kernel` | `704c382141096313560a2922f2a067bdf1e10783` |
| `room/freeze-boundary` | `9d4ff794d1f612a6523c584d1635bfedd1ce1a1f` |
| `security/minor-report-abuse-hardening` | `de4ef27d2a4fb3e94188f3a9b82072d4366ff2f2` |
| `test/community-operational-validation-current` | `711061ff9625a100c4d217ed6a3fe27cf53db06f` |
| `test/notifications-error-boundary-closure` | `1f2b7e9773519e2b3cc481bc642fdd523fa6112c` |
| `ux/age-verification-guided-flow` | `366f6c98900d81a91b07193d83550de8fdfcca85` |
| `validation/community-operational-no-deploy-20260920` | `63b170c57594470233f35b1eab79d4df98b31cef` |
