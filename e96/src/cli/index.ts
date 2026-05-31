#!/usr/bin/env node

import { Command } from 'commander';
import * as fs from 'fs-extra';
import { MigrationConfig } from '../types';
import { MigrationCoordinator } from '../migration/coordinator';
import { exampleConfig } from '../config/example';

const program = new Command();

program
  .name('migrate')
  .description('MySQL to PostgreSQL data migration tool with validation')
  .version('1.1.0');

program
  .command('init')
  .description('Create example configuration file')
  .option('-o, --output <path>', 'Output file path', 'config.json')
  .action(async (options) => {
    try {
      await fs.writeJson(options.output, exampleConfig, { spaces: 2 });
      console.log(`Example config created at ${options.output}`);
      console.log('Please edit the configuration file with your database credentials.');
    } catch (error) {
      console.error(`Failed to create config: ${error}`);
      process.exit(1);
    }
  });

program
  .command('migrate')
  .description('Run data migration')
  .requiredOption('-c, --config <path>', 'Path to configuration file')
  .option('--no-validate', 'Skip data validation after migration')
  .option('--server', 'Start web monitoring server')
  .option('--port <port>', 'Web server port', '3001')
  .option('--delta-sync', 'Start delta sync after full migration')
  .option('--timestamp-column <column>', 'Timestamp column for delta sync')
  .option('--sla-report <path>', 'Generate SLA report at the end')
  .action(async (options) => {
    try {
      const config: MigrationConfig = await fs.readJson(options.config);
      
      if (options.validate === false) {
        config.validate = false;
      }

      const runMigration = async (coordinator: MigrationCoordinator) => {
        console.log('Starting migration...');
        await coordinator.migrateSchemas();
        await coordinator.migrateData();
        
        if (options.slaReport) {
          await coordinator.saveSLAReport(options.slaReport);
        }

        if (options.deltaSync) {
          console.log('Starting delta sync...');
          coordinator.startDeltaSync(options.timestampColumn);
          
          process.on('SIGINT', () => {
            console.log('\nStopping delta sync...');
            coordinator.stopDeltaSync();
            coordinator.close().then(() => process.exit(0));
          });
        } else {
          await coordinator.close();
        }
      };

      if (options.server) {
        const { startServer } = await import('../server');
        const server = await startServer(config, parseInt(options.port));
        console.log(`Web monitoring server started on http://localhost:${options.port}`);
        
        const coordinator = new MigrationCoordinator(config, server.callbacks);
        await runMigration(coordinator);
      } else {
        const coordinator = new MigrationCoordinator(config, {
          onProgress: (progress) => {
            const percent = progress.totalRows > 0 
              ? ((progress.migratedRows / progress.totalRows) * 100).toFixed(2)
              : '0.00';
            console.log(
              `[${progress.tableName}] ${progress.status} | ` +
              `${progress.migratedRows}/${progress.totalRows} (${percent}%) | ` +
              `Failed: ${progress.failedRows} | ` +
              `Speed: ${progress.rowsPerSecond.toFixed(2)} rows/s | ` +
              `ETA: ${formatTime(progress.estimatedRemainingTime)}`
            );
          },
          onComplete: () => {
            console.log('\nMigration completed!');
          },
          onError: (error) => {
            console.error(`Migration error: ${error.message}`);
          },
          onDeltaChange: (change) => {
            console.log(`[Delta] ${change.type} ${change.tableName} #${change.primaryKey}`);
          }
        });

        await runMigration(coordinator);
      }
    } catch (error) {
      console.error(`Migration failed: ${error}`);
      process.exit(1);
    }
  });

program
  .command('delta-sync')
  .description('Run delta synchronization (incremental sync)')
  .requiredOption('-c, --config <path>', 'Path to configuration file')
  .option('--timestamp-column <column>', 'Timestamp column for detecting changes')
  .option('--version-column <column>', 'Version column for detecting changes')
  .action(async (options) => {
    try {
      const config: MigrationConfig = await fs.readJson(options.config);
      
      const coordinator = new MigrationCoordinator(config, {
        onDeltaChange: (change) => {
          console.log(`[Delta] ${change.type} ${change.tableName} #${change.primaryKey}`);
        },
        onDeltaStatus: (status) => {
          console.log(
            `[Sync Status] ${status.tableName}: ` +
            `processed=${status.processedChanges}, ` +
            `pending=${status.pendingChanges}, ` +
            `errors=${status.errors}`
          );
        }
      });

      console.log('Starting delta sync... (Press Ctrl+C to stop)');
      coordinator.startDeltaSync(options.timestampColumn, options.versionColumn);

      process.on('SIGINT', () => {
        console.log('\nStopping delta sync...');
        coordinator.stopDeltaSync();
        coordinator.close().then(() => process.exit(0));
      });
    } catch (error) {
      console.error(`Delta sync failed: ${error}`);
      process.exit(1);
    }
  });

program
  .command('repair')
  .description('Repair data inconsistencies')
  .requiredOption('-c, --config <path>', 'Path to configuration file')
  .requiredOption('-t, --table <table>', 'Table name to repair')
  .option('--interactive', 'Interactive repair confirmation')
  .option('--auto-confirm', 'Automatically confirm all repairs')
  .option('--save-session <path>', 'Save repair session to file')
  .action(async (options) => {
    try {
      const config: MigrationConfig = await fs.readJson(options.config);
      
      console.log('Repair mode is currently designed to work with validation mismatches.');
      console.log('Please run a validation first to identify mismatches.');
      console.log('Then use the mismatches to create a repair session.');
      
      const coordinator = new MigrationCoordinator(config);
      
      console.log(`\nTo repair table ${options.table}:`);
      console.log('1. Run validation to get mismatches');
      console.log('2. Load source and target rows for mismatched records');
      console.log('3. Call coordinator.createRepairSession() with the data');
      console.log('4. Call coordinator.confirmAndExecuteRepairs() to apply fixes');
      
      await coordinator.close();
    } catch (error) {
      console.error(`Repair failed: ${error}`);
      process.exit(1);
    }
  });

program
  .command('sla-report')
  .description('Generate SLA report from migration history')
  .requiredOption('-c, --config <path>', 'Path to configuration file')
  .requiredOption('-o, --output <path>', 'Output path for the report')
  .action(async (options) => {
    try {
      const config: MigrationConfig = await fs.readJson(options.config);
      
      const coordinator = new MigrationCoordinator(config);
      
      console.log('Generating SLA report...');
      await coordinator.saveSLAReport(options.output);
      
      console.log(`SLA report saved to ${options.output}`);
      console.log(`Text report saved to ${options.output.replace('.json', '.txt')}`);
      
      await coordinator.close();
    } catch (error) {
      console.error(`Failed to generate SLA report: ${error}`);
      process.exit(1);
    }
  });

program
  .command('validate')
  .description('Validate data consistency between source and target')
  .requiredOption('-c, --config <path>', 'Path to configuration file')
  .option('--table <table>', 'Validate specific table only')
  .option('--sla-report <path>', 'Generate SLA report after validation')
  .action(async (options) => {
    try {
      const config: MigrationConfig = await fs.readJson(options.config);
      
      console.log('Starting validation...');
      
      const coordinator = new MigrationCoordinator(config, {
        onProgress: (progress) => {
          const percent = progress.totalRows > 0 
            ? ((progress.validatedRows / progress.totalRows) * 100).toFixed(2)
            : '0.00';
          console.log(
            `[${progress.tableName}] ${progress.status} | ` +
            `${progress.validatedRows}/${progress.totalRows} (${percent}%) | ` +
            `Failed: ${progress.validationFailedRows} | ` +
            `Speed: ${progress.rowsPerSecond.toFixed(2)} rows/s`
          );
        },
        onComplete: () => {
          console.log('\nValidation completed!');
        }
      });

      const migrator = coordinator.getMigrator();
      if (migrator) {
        await migrator.loadCheckpoints();
      }

      const { DataValidator } = await import('../migration/validator');
      const validator = new DataValidator(
        coordinator.getMySQLClient(),
        coordinator.getPostgreSQLClient(),
        (progress) => {
          const percent = progress.totalRows > 0 
            ? ((progress.validatedRows / progress.totalRows) * 100).toFixed(2)
            : '0.00';
          console.log(
            `[${progress.tableName}] ${progress.status} | ` +
            `${progress.validatedRows}/${progress.totalRows} (${percent}%) | ` +
            `Failed: ${progress.validationFailedRows} | ` +
            `Speed: ${progress.rowsPerSecond.toFixed(2)} rows/s`
          );
        }
      );

      const tablesToValidate = options.table 
        ? config.tables.filter(t => t.sourceTable === options.table)
        : config.tables;

      for (const tableConfig of tablesToValidate) {
        const schema = await coordinator.getMySQLClient().getTableSchema(tableConfig.sourceTable);
        const checkpoint = {
          tableName: tableConfig.sourceTable,
          lastPrimaryKey: null,
          migratedRows: schema.rowCount,
          failedRows: 0,
          validatedRows: 0,
          validationFailedRows: 0,
          status: 'migrated' as const,
          startTime: Date.now()
        };
        
        const mismatches = await validator.validateTable(tableConfig, schema, checkpoint);
        
        if (mismatches.length > 0) {
          console.log(`\nFound ${mismatches.length} mismatches in table ${tableConfig.sourceTable}`);
          const mismatchFile = `./mismatches-${tableConfig.sourceTable}.json`;
          await fs.writeJson(mismatchFile, mismatches, { spaces: 2 });
          console.log(`Mismatches saved to ${mismatchFile}`);
        } else {
          console.log(`\nTable ${tableConfig.sourceTable}: All records validated successfully!`);
        }
      }

      if (options.slaReport) {
        await coordinator.saveSLAReport(options.slaReport);
      }

      await coordinator.close();
    } catch (error) {
      console.error(`Validation failed: ${error}`);
      process.exit(1);
    }
  });

function formatTime(ms: number): string {
  if (ms === Infinity || ms < 0) return '--:--:--';
  const seconds = Math.floor(ms / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

program.parseAsync(process.argv).catch(console.error);
