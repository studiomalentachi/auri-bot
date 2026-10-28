function localParts(
  timezone = 'America/Sao_Paulo'
) {
  const parts =
    new Intl.DateTimeFormat(
      'en-CA',
      {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }
    )
      .formatToParts(
        new Date()
      )
      .reduce(
        (acc, part) => {
          acc[part.type] =
            part.value;
          return acc;
        },
        {}
      );

  return {
    year:
      Number(parts.year),
    month:
      Number(parts.month),
    day:
      Number(parts.day)
  };
}

function mdNumber(
  month,
  day
) {
  return (
    Number(month) * 100 +
    Number(day)
  );
}

function inWindow(
  md,
  start,
  end
) {
  if (start <= end) {
    return (
      md >= start &&
      md <= end
    );
  }

  // janela cruza o ano
  return (
    md >= start ||
    md <= end
  );
}

export function getBrazilSeasonalContext(
  timezone =
    'America/Sao_Paulo'
) {
  const {
    year,
    month,
    day
  } =
    localParts(timezone);

  const md =
    mdNumber(
      month,
      day
    );

  let season =
    'verão';

  if (
    inWindow(
      md,
      321,
      620
    )
  ) {
    season =
      'outono';
  } else if (
    inWindow(
      md,
      621,
      922
    )
  ) {
    season =
      'inverno';
  } else if (
    inWindow(
      md,
      923,
      1220
    )
  ) {
    season =
      'primavera';
  }

  const events = [];

  const add = (
    label,
    keywords
  ) => {
    events.push({
      label,
      keywords
    });
  };

  // Janelas comerciais amplas.
  // Não dependem de uma data exata de feriado para funcionar.
  if (
    inWindow(
      md,
      1201,
      131
    )
  ) {
    add(
      'Natal e Ano-Novo',
      [
        'presentes de natal',
        'decoração de natal',
        'mesa posta natal',
        'itens para confraternização',
        'look de fim de ano',
        'organização para festas'
      ]
    );
  }

  if (
    inWindow(
      md,
      101,
      215
    )
  ) {
    add(
      'Férias de verão',
      [
        'itens para viagem',
        'mala de viagem',
        'bolsa térmica',
        'garrafa térmica',
        'ventilador',
        'climatizador',
        'roupas leves',
        'sandália feminina'
      ]
    );
  }

  if (
    inWindow(
      md,
      115,
      215
    )
  ) {
    add(
      'Volta às aulas',
      [
        'papelaria',
        'cadernos',
        'canetas',
        'mochila',
        'estojo',
        'organizador de mesa',
        'luminária de estudo',
        'suporte para notebook'
      ]
    );
  }

  if (
    inWindow(
      md,
      201,
      310
    )
  ) {
    add(
      'Carnaval',
      [
        'acessórios coloridos',
        'maquiagem com brilho',
        'bolsa pequena',
        'pochete',
        'óculos de sol',
        'garrafa de água',
        'look leve'
      ]
    );
  }

  if (
    inWindow(
      md,
      315,
      420
    )
  ) {
    add(
      'Páscoa',
      [
        'chocolate',
        'doces',
        'cafeteira',
        'canecas',
        'mesa posta',
        'formas de chocolate',
        'itens para café'
      ]
    );
  }

  if (
    inWindow(
      md,
      501,
      515
    )
  ) {
    add(
      'Presentes de maio',
      [
        'perfume feminino',
        'bolsa feminina',
        'joias minimalistas',
        'cafeteira',
        'kit skincare',
        'itens de autocuidado',
        'decoração elegante'
      ]
    );
  }

  if (
    inWindow(
      md,
      525,
      630
    )
  ) {
    add(
      'Festa Junina',
      [
        'itens para festa junina',
        'caneca',
        'panela',
        'cafeteira',
        'itens para cozinha',
        'decoração rústica',
        'roupas xadrez'
      ]
    );
  }

  if (
    inWindow(
      md,
      601,
      612
    )
  ) {
    add(
      'Dia dos Namorados',
      [
        'perfume feminino',
        'perfume masculino',
        'joias minimalistas',
        'relógio',
        'bolsa',
        'carteira',
        'presente romântico'
      ]
    );
  }

  if (
    inWindow(
      md,
      621,
      831
    )
  ) {
    add(
      'Temporada de inverno',
      [
        'cobertor',
        'manta para sofá',
        'edredom',
        'aquecedor',
        'chaleira elétrica',
        'cafeteira',
        'pantufa',
        'casaco feminino',
        'moletom'
      ]
    );
  }

  if (
    inWindow(
      md,
      801,
      815
    )
  ) {
    add(
      'Presentes de agosto',
      [
        'perfume masculino',
        'relógio masculino',
        'carteira masculina',
        'kit ferramentas',
        'acessórios automotivos',
        'cafeteira',
        'fone bluetooth'
      ]
    );
  }

  if (
    inWindow(
      md,
      901,
      1031
    )
  ) {
    add(
      'Primavera',
      [
        'decoração floral',
        'vasos decorativos',
        'organização da casa',
        'roupa de cama leve',
        'vestido feminino',
        'bolsa feminina',
        'skincare',
        'itens para varanda'
      ]
    );
  }

  if (
    inWindow(
      md,
      1001,
      1015
    )
  ) {
    add(
      'Dia das Crianças',
      [
        'brinquedos',
        'brinquedos educativos',
        'jogos',
        'papelaria infantil'
      ]
    );
  }

  if (
    inWindow(
      md,
      1015,
      1031
    )
  ) {
    add(
      'Halloween',
      [
        'decoração halloween',
        'maquiagem halloween',
        'luzes decorativas',
        'fantasia',
        'itens para festa'
      ]
    );
  }

  if (
    inWindow(
      md,
      1101,
      1130
    )
  ) {
    add(
      'Black Friday',
      [
        'eletrodomésticos',
        'eletroportáteis',
        'smartwatch',
        'fone bluetooth',
        'aspirador',
        'robô aspirador',
        'cafeteira',
        'air fryer',
        'móveis para casa'
      ]
    );
  }

  const seasonKeywords = {
    verão: [
      'ventilador',
      'climatizador',
      'garrafa térmica',
      'itens para viagem',
      'roupas leves',
      'sandália feminina',
      'organização de verão'
    ],

    outono: [
      'manta para sofá',
      'cafeteira',
      'chaleira elétrica',
      'decoração aconchegante',
      'roupa de cama',
      'organização da casa'
    ],

    inverno: [
      'edredom',
      'cobertor',
      'manta para sofá',
      'aquecedor',
      'cafeteira',
      'chaleira elétrica',
      'pantufa'
    ],

    primavera: [
      'vasos decorativos',
      'decoração floral',
      'roupa de cama leve',
      'organização da casa',
      'itens para varanda',
      'vestido feminino',
      'skincare'
    ]
  };

  const eventKeywords =
    events.flatMap(
      (x) =>
        x.keywords
    );

  const keywords = [
    ...new Set([
      ...(
        seasonKeywords[
          season
        ] || []
      ),
      ...eventKeywords
    ])
  ];

  return {
    year,
    month,
    day,
    season,
    events,
    labels: [
      season,
      ...events.map(
        (x) => x.label
      )
    ],
    keywords
  };
}
