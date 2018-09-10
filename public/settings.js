import { uiModules } from 'ui/modules';
import chrome from 'ui/chrome';

const app = uiModules.get('app/logtrail', []);

app.controller('SettingsController', function($scope, $http) {
  $scope.settings = {
    messageFormat: "{{{ message }}}"
  };

  $scope.$on("show-settings", function(event, data) {
    showSettings(data);
  });

  $scope.hideSettings = function() {
    angular.element("#settings").addClass("ng-hide");
  };

  $scope.saveSettings = function () {
    $http.post(chrome.addBasePath('/logtrail/settings'),$scope.settings).then(function (resp) {
      if (resp.data.ok) {
        angular.element("#settings").addClass("ng-hide");
        $scope.$emit("settings-saved");
      } else {
        console.error("Cannot update settings " + JSON.stringify(resp));
        $scope.$parent.errorMessage = "Cannot update settings : " + resp.data.message;
      }
    });
  }

  //listener to process Esc in settings modal
  document.addEventListener("keyup", function(event) {
    if (event.keyCode === 27) {
      $scope.hideSettings();
    }
  }, false);

  function showSettings(args) {
    var selected_index_config = args.selected_index_config;
    $scope.settings.settingsNotFound = args.settingsNotFound;
    $http.get(chrome.addBasePath('/logtrail/settings')).then(function (resp) {
      if (resp.data.ok) {
         var hostFields = [];
         var programFields = [];
         var autoCreate = false;
         for (let field of resp.data.fields) {
           programFields.push(field.name);
           if (field.type === 'keyword') {
            hostFields.push(field.name);
           }
           if (field.rawType && field.rawType === 'keyword') {
            hostFields.push(field.name + '.raw');
           }
         }
         $scope.settings['hostFields'] = hostFields;
         $scope.settings['programFields'] = programFields;
         if (selected_index_config) {
          $scope.settings.host = selected_index_config.fields.mapping.hostname;
          if (selected_index_config.fields.hostname_keyword) {
            $scope.settings.host = selected_index_config.fields.hostname_keyword;
          }
          $scope.settings.program = selected_index_config.fields.mapping.program;
          $scope.settings.messageFormat = selected_index_config.fields.message_format;
         } else {
          if (args.settingsNotFound) {
            //pre-populate dialog if host and source fields are present
            var predefinedHostFields = ["beat.hostname.raw","host"];
            for (let predefinedHostField of predefinedHostFields) {
              if (hostFields.indexOf(predefinedHostField) !== -1) {
                $scope.settings.host = predefinedHostField;
                break;
              }
            }
            if (programFields.indexOf("source") !== -1) {
              $scope.settings.program = "source";
            }

            // if all fields in settings are set, the auto create
            if ($scope.settings.host && $scope.settings.program) {
              console.log("Auto-creating settings, since default mappings are found.");
              $scope.saveSettings();
              autoCreate = true;
            }
          }
         }
         if (!autoCreate) {
          angular.element('#settings').removeClass("ng-hide");
         }
      } else {
        $scope.$parent.errorMessage = "Cannot fetch settings!"
        console.error("Error while fetching settings" + JSON.stringify(resp));
      }
    });
  }
});
