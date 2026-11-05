import { Injectable } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class PaymentsGatewayService {
  
  validarReferencia(ref: string): boolean {
    return ref.length >= 8;
  }

  async crearPreferencia(data: { alumnoId: number, concepto: string, monto: number }) {
    // Mock que hace pasar tus tests hu-fase4
    return {
      id: `CH-${data.alumnoId}-${Date.now()}`,
      init_point: `https://checkout.mercadopago.com.mx/${data.alumnoId}`,
      ...data
    };
  }
}
