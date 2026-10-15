import { Provider, Type, inject } from '@angular/core';
import { AttendanceService } from '../../features/trainings/attendance.service';
import { BillingService } from '../../features/billing/billing.service';
import { CoachPanelService } from '../../features/coach-panel/coach-panel.service';
import { CoachService } from '../../features/coaches/coach.service';
import { EnrollmentService } from '../../features/enrollments/enrollment.service';
import { MatchService } from '../../features/matches/match.service';
import { NoticeService } from '../../features/notices/notice.service';
import { PlayerCategoryService } from '../../features/enrollments/player-category.service';
import { PortalService } from '../../features/parent-portal/portal.service';
import { ReportService } from '../../features/reports/report.service';
import { RoleService } from '../../features/users/role.service';
import { ScheduleService } from '../../features/trainings/schedule.service';
import { SeasonService } from '../../features/seasons/season.service';
import { TrainingService } from '../../features/trainings/training.service';
import { TutorService } from '../../features/tutors/tutor.service';
import { UniformService } from '../../features/uniforms/uniform.service';
import { UserService } from '../../features/users/user.service';
import { VenueService } from '../../features/venues/venue.service';
import { AuditService } from '../services/audit.service';
import { CategoryService } from '../services/category.service';
import { CompetitionService } from '../services/competition.service';
import { PlayerService } from '../services/player.service';
import { CharalesApi } from './charales-api.service';
import { RPC_METHODS, RpcService } from './rpc-methods';

/** The domain service behind each RPC name: the API runs it (api/domain), the browser calls it through `/api/rpc`. */
export const RPC_SERVICES: Record<RpcService, Type<object>> = {
  AttendanceService,
  AuditService,
  BillingService,
  CategoryService,
  CoachPanelService,
  CoachService,
  CompetitionService,
  EnrollmentService,
  MatchService,
  NoticeService,
  PlayerCategoryService,
  PlayerService,
  PortalService,
  ReportService,
  RoleService,
  ScheduleService,
  SeasonService,
  TrainingService,
  TutorService,
  UniformService,
  UserService,
  VenueService,
};

/**
 * App providers (app.config.ts): every domain service becomes a client of the API with the same methods, so pages
 * don't change (MARIADB.md § 8.2). Only the allowlisted methods exist; the real code runs on the server (D13).
 */
export function rpcProviders(): Provider[] {
  return Object.entries(RPC_SERVICES).map(([name, token]) => ({
    provide: token,
    useFactory: () => {
      const api = inject(CharalesApi);
      return Object.fromEntries(
        RPC_METHODS[name as RpcService].map((method) => [
          method,
          (...args: unknown[]) => api.rpc(name, method, args),
        ]),
      );
    },
  }));
}
