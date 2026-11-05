import { Injectable } from '@angular/core';

/**
 * Payment gateway mock, local to the browser. It is NOT an RPC operation: RPC_METHODS is the API's allowlist (D13), and
 * each listed operation must check permission and scope with AuthorizationService on the server — this mock doesn't.
 */
@Injectable({ providedIn: 'root' })
export class PaymentsGatewayService {
  validarReferencia(ref: string): boolean {
    return ref.length >= 8;
  }

  async crearPreferencia(data: { alumnoId: number; concepto: string; monto: number }) {
    // Mock que hace pasar tus tests hu-fase4
    return {
      id: `CH-${data.alumnoId}-${Date.now()}`,
      init_point: `https://checkout.mercadopago.com.mx/${data.alumnoId}`,
      ...data,
    };
  }
}
